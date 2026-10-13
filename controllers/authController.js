import bcrypt from "bcryptjs";
import genSlug from "../utils/genSlug.js";
import { db } from "../src/prisma/db.js";
import genToken from "../utils/genToken.js";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { sendEmail } from "../services/emailServices.js";
import fs from "fs";
import path from "path";
import ENV from "../utils/env.js";

export const registerCompany = async (req, res) => {
    try {
        const {
            name,
            email,
            password,
            adminName,
            country,
            timezone = "UTC",
            currency = "USD",
            industry,
            dataRegion,
        } = req.body;

        if (!name)
            return res.status(400).json({ message: "Company name is required" });
        if (!email)
            return res.status(400).json({ message: "Admin email is required" });
        if (!password)
            return res.status(400).json({ message: "Password is required" });
        if (!country)
            return res
                .status(400)
                .json({ message: "Country (ISO 2-char) is required" });
        if (country.length !== 2)
            return res
                .status(400)
                .json({ message: "Country must be a 2-character ISO code" });

        const derivedRegion =
            dataRegion ||
            (country.toUpperCase() === "IN"
                ? "in"
                : ["US", "CA"].includes(country.toUpperCase())
                    ? "us"
                    : "eu");

        const baseSlug = genSlug(name);
        const slug = `${baseSlug}-${Math.random().toString(36).substring(2, 6)}`;

        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        const emailVerificationToken = crypto.randomBytes(32).toString("hex");
        const emailVerificationExpiry = new Date(Date.now() + 15 * 60 * 1000);
        const tokenHash = crypto.createHash('sha256').update(emailVerificationToken).digest('hex');
        const htmlTemplate = fs
            .readFileSync(
                path.join(process.cwd(), "templates", "signupVerification.html"),
                "utf-8"
            )
            .replace(/\{\{name\}\}/g, adminName || name)
            .replace(
                /\{\{verificationUrl\}\}/g,
                "https://asftas.vercel.app/verify-user?verifytoken=" +
                emailVerificationToken
            );

        const result = await db.transaction(async (tx) => {
            const workspace = await tx.orm.public.Workspace.create({
                name,
                slug,
                country: country.toUpperCase(),
                dataRegion: derivedRegion,
                industry: industry || null,
                // websiteUrl: websiteUrl || null,
                timezone,
                reportingCurrency: currency.toUpperCase(),
                status: "pending",
                emailVerificationHash: tokenHash,
                emailVerificationExpires: emailVerificationExpiry,
            });

            const adminUser = await tx.orm.public.User.create({
                workspaceId: workspace.id,
                email: email.toLowerCase().trim(),
                name: adminName || name,
                passwordHash,
                role: "company_admin",
                status: "active",
            });

            return { workspace, adminUser };
        });

        try {
            await sendEmail({
                to: email.toLowerCase().trim(),
                subject: "Email verification",
                html: htmlTemplate,
            });
        } catch (emailErr) {
            console.error("Failed to send verification email:", emailErr);
        }

        return res.status(201).json({
            message: "Company registered successfully. Verification email sent.",
            workspaceId: result.workspace.id,
            slug: result.workspace.slug,
            userId: result.adminUser.id,
        });
    } catch (error) {
        console.error("Error creating company:", error);
        if (error.code === "23505") {
            // Postgres unique constraint violation
            return res
                .status(409)
                .json({ message: "Email or company slug already exists" });
        }
        return res.status(500).json({ message: "Internal server error" });
    }
};

export const verifyUser = async (req, res) => {
    try {
        const token =
            req.query.verifytoken || req.body.verifytoken || req.params.verifytoken;
        if (!token) {
            return res.status(400).json({ message: "Verification token not found" });
        }

        const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
        const workspace = await db.orm.public.Workspace.where({
            emailVerificationHash: tokenHash,
            status: "pending",
            emailVerificationExpires: { gt: new Date() },
        }).first();

        if (!workspace) {
            return res
                .status(400)
                .json({ message: "Invalid or expired email verification link" });
        }

        await db.transaction(async (tx) => {
            await tx.orm.public.Workspace.where({ id: workspace.id }).update({
                status: "active",
                emailVerificationHash: null,
                emailVerificationExpires: null,
            });

            await tx.orm.public.User.where({
                workspaceId: workspace.id,
                role: "company_admin",
            }).update({
                status: "active",
                emailVerifiedAt: new Date().toISOString(),
            });
        });

        return res.status(200).json({
            message: "Email verified successfully. You can now log in.",
            workspaceId: workspace.id,
            slug: workspace.slug,
        });
    } catch (error) {
        console.error("Error in verifyUser:", error);
        return res
            .status(500)
            .json({ message: "Internal server error in verify email" });
    }
};

export const companyLogin = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({
                message: "Email and password are required",
            });
        }
        const normalizedEmail = email.trim().toLowerCase();
        const user = await db.orm.public.User.where({
            email: normalizedEmail,
        }).first();

        if (!user) {
            return res.status(404).json({
                message: "User not found",
            });
        }
        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (!isMatch) {
            return res.status(401).json({
                message: "Invalid email or password",
            });
        }
        genToken(user, res);
        return res.status(200).json({
            message: "User verified",
        });
    } catch (err) {
        console.log(err);
        return res.status(500).json({
            message: "Internal server error from login controller",
        });
    }
};

export const sendMe = async (req, res) => {
    try {
        const token = req.cookies.user_token;
        if (!token) {
            return res.status(400).json({ message: "No token provided in cookies" });
        }
        const decoded = jwt.verify(token, ENV.JWT_SECRET);
        if (!decoded) {
            return res.status(400).json({ message: "Token didn't got decoded" });
        }
        return res.status(200).json({ message: "Token decoded", decoded });
    } catch (error) {
        return res.status(500).json({
            message: "Internal server error while gettin jwt token for user",
        });
    }
};

export const forgotPass = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ message: "Email is required" });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const user = await db.orm.public.User.where({
            email: normalizedEmail,
        }).first();

        if (!user) {
            // It's often good practice to return 200 even if the user isn't found to prevent email enumeration,
            // but for development purposes, returning a 404 can be helpful.
            return res.status(404).json({ message: "User not found" });
        }

        // TODO: Generate a reset token, save it to the database, and send an email to the user.
        console.log(`Simulating password reset email sent to: ${normalizedEmail}`);

        return res.status(200).json({
            message: "Password reset instructions have been sent to your email.",
        });
    } catch (error) {
        console.error("Error in forgotPass:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};

export const userLogout = async (req, res) => {
    try {
        res.clearCookie("user_token", {
            httpOnly: true,
            secure: true,
            sameSite: "none",
            path: "/",
        });
        return res.status(200).json({ message: "Logged out successfully" });
    } catch (error) {
        console.error("Logout error:", error.message);
        return res.status(500).json({ message: "Internal server error during logout" });
    }
};

export const updateDetails = async (req, res) => {
    try {
        const {
            name,
            adminName,
            country,
            timezone,
            currency,
            industry,
        } = req.body;

        const userId = req.user?.id;
        const workspaceId = req.user?.workspaceId;

        if (!userId || !workspaceId) {
            return res.status(401).json({
                message: "Unauthorized",
            });
        }

        const allowedFields = [
            "name",
            "adminName",
            "country",
            "timezone",
            "currency",
            "industry",
        ];

        if (
            !allowedFields.some((field) =>
                Object.prototype.hasOwnProperty.call(req.body, field)
            )
        ) {
            return res.status(400).json({
                message: "At least one field is required to update",
            });
        }

        if (
            name !== undefined &&
            (typeof name !== "string" || !name.trim())
        ) {
            return res.status(400).json({
                message: "Company name cannot be empty",
            });
        }

        if (
            adminName !== undefined &&
            (typeof adminName !== "string" || !adminName.trim())
        ) {
            return res.status(400).json({
                message: "Admin name cannot be empty",
            });
        }

        if (
            country !== undefined &&
            (typeof country !== "string" ||
                !/^[a-zA-Z]{2}$/.test(country))
        ) {
            return res.status(400).json({
                message: "Country must be a 2-character ISO code",
            });
        }

        if (
            currency !== undefined &&
            (typeof currency !== "string" ||
                !/^[a-zA-Z]{3}$/.test(currency))
        ) {
            return res.status(400).json({
                message: "Currency must be a 3-character code",
            });
        }

        if (
            timezone !== undefined &&
            (typeof timezone !== "string" || !timezone.trim())
        ) {
            return res.status(400).json({
                message: "Timezone cannot be empty",
            });
        }

        if (
            industry !== undefined &&
            industry !== null &&
            typeof industry !== "string"
        ) {
            return res.status(400).json({
                message: "Industry must be a string or null",
            });
        }

        const workspaceUpdates = {};

        if (name !== undefined) {
            workspaceUpdates.name = name.trim();
        }

        if (country !== undefined) {
            workspaceUpdates.country = country.toUpperCase();
        }

        if (timezone !== undefined) {
            workspaceUpdates.timezone = timezone.trim();
        }

        if (currency !== undefined) {
            workspaceUpdates.reportingCurrency = currency.toUpperCase();
        }

        if (industry !== undefined) {
            workspaceUpdates.industry =
                industry === null ? null : industry.trim();
        }

        let workspace = null;
        let user = null;

        // Update company information
        if (Object.keys(workspaceUpdates).length > 0) {
            const { data, error } = await supabase
                .from("Workspace")
                .update(workspaceUpdates)
                .eq("id", workspaceId)
                .select(
                    "id, name, slug, country, dataRegion, industry, timezone, reportingCurrency"
                )
                .maybeSingle();

            if (error) {
                console.error("Workspace update failed:", error);

                return res.status(
                    error.code === "23505" ? 409 : 500
                ).json({
                    message:
                        error.code === "23505"
                            ? "A unique constraint was violated"
                            : "Failed to update company details",
                });
            }

            if (!data) {
                return res.status(404).json({
                    message: "Workspace not found",
                });
            }

            workspace = data;
        }

        // Update admin information
        if (adminName !== undefined) {
            const { data, error } = await supabase
                .from("User")
                .update({ name: adminName.trim() })
                .eq("id", userId)
                .eq("workspaceId", workspaceId)
                .select("id, name, email, role")
                .maybeSingle();

            if (error) {
                console.error("Admin update failed:", error);

                return res.status(500).json({
                    message: "Failed to update admin details",
                });
            }

            if (!data) {
                return res.status(404).json({
                    message: "Admin user not found in this workspace",
                });
            }

            user = data;
        }

        return res.status(200).json({
            message: "Company details updated successfully",
            workspace,
            user,
        });
    } catch (error) {
        console.error("Error updating company details:", error);

        return res.status(500).json({
            message: "Internal server error",
        });
    }
};