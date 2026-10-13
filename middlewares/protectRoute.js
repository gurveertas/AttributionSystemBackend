import jwt from "jsonwebtoken";
import ENV from "../utils/env.js";
import { db } from "../src/prisma/db.js";

export const protectRoute = async (req, res, next) => {
  try {
    const token = req.cookies?.user_token;
    if (!token) return res.status(401).json({ message: "Not logged in" });
    let decoded;
    try {
      decoded = jwt.verify(token, ENV.JWT_SECRET);
    } catch (err) {
      const message = err.name === "TokenExpiredError" ? "Session expired" : "Invalid token";
      return res.status(401).json({ message });
    }
    const user = await db.orm.public.User.where({ id: decoded.id }).first();
    if (!user) return res.status(401).json({ message: "User no longer exists" });
    if (user.status !== "active")
      return res.status(403).json({ message: "Account is not active" });
    req.user = {
      id: user.id,
      role: user.role,
      workspaceId: user.workspaceId ?? null,
      name: user.name,
      email: user.email,
    };
    return next();
  } catch (error) {
    console.error("protectRoute error:", error.message);
    return res.status(500).json({ message: "Internal server error in auth check" });
  }
};
export const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: "Not logged in" });
    if (!roles.includes(req.user.role))
      return res.status(403).json({ message: "You do not have permission for this action" });
    return next();
  };

export default protectRoute;