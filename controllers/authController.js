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
    res.cookie("user_token", "", {
      expires: new Date(0),
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });

    return res.status(200).json({
      message: "Logged out successfully",
    });
  } catch (error) {
    console.error("Error in userLogout:", error);
    return res.status(500).json({
      message: "Internal server error during logout",
    });
  }
};