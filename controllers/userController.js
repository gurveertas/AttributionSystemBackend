/**
 * User Controller — company profile updates
 *
 * PATCH /api/user/update-details
 * Allows a company admin to update their workspace and/or their own profile name.
 */

import { db } from "../src/prisma/db.js";

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
            try {
                await db.orm.public.Workspace.where({ id: workspaceId }).update(workspaceUpdates);
                workspace = await db.orm.public.Workspace.where({ id: workspaceId }).first();
                if (!workspace) {
                    return res.status(404).json({
                        message: "Workspace not found",
                    });
                }
                // Remove sensitive fields
                const { emailVerificationHash, emailVerificationExpires, ...safe } = workspace;
                workspace = safe;
            } catch (error) {
                console.error("Workspace update failed:", error);
                if (error?.code === "23505") {
                    return res.status(409).json({
                        message: "A unique constraint was violated",
                    });
                }
                return res.status(500).json({
                    message: "Failed to update company details",
                });
            }
        }

        // Update admin information
        if (adminName !== undefined) {
            try {
                await db.orm.public.User.where({ id: userId, workspaceId }).update({ name: adminName.trim() });
                const updatedUser = await db.orm.public.User.where({ id: userId }).first();
                if (!updatedUser) {
                    return res.status(404).json({
                        message: "Admin user not found in this workspace",
                    });
                }
                const { passwordHash, ...safeUser } = updatedUser;
                user = safeUser;
            } catch (error) {
                console.error("Admin update failed:", error);
                return res.status(500).json({
                    message: "Failed to update admin details",
                });
            }
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