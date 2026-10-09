import bcrypt from 'bcryptjs';
import genSlug from '../utils/genSlug.js';
import { db } from '../src/prisma/db.js';
import genToken  from '../utils/genToken.js';
import jwt from 'jsonwebtoken';

export const registerCompany = async (req, res) => {
    try {
            const {
                name,
                email,
                password,
                adminName,  
                country,
                timezone = 'UTC',
                currency = 'USD',
                industry,
                dataRegion,
            } = req.body;
    
            if (!name) return res.status(400).json({ message: "Company name is required" });
            if (!email) return res.status(400).json({ message: "Admin email is required" });
            if (!password) return res.status(400).json({ message: "Password is required" });
            if (!country) return res.status(400).json({ message: "Country (ISO 2-char) is required" });
            if (country.length !== 2) return res.status(400).json({ message: "Country must be a 2-character ISO code" });
    
            const derivedRegion = dataRegion || (country.toUpperCase() === 'IN' ? 'in' : ['US', 'CA'].includes(country.toUpperCase()) ? 'us' : 'eu');
    
            const baseSlug = genSlug(name);
            const slug = `${baseSlug}-${Math.random().toString(36).substring(2, 6)}`;
    
            const saltRounds = 10;
            const passwordHash = await bcrypt.hash(password, saltRounds);
    
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
                    status: 'pending'
                });
    
                const adminUser = await tx.orm.public.User.create({
                    workspaceId: workspace.id,
                    email: email.toLowerCase().trim(),
                    name: adminName || name,
                    passwordHash,
                    role: 'company_admin',
                    status: 'active'
                });
    
                return { workspace, adminUser };
            });
    
            return res.status(201).json({
                message: "Company registered successfully",
                workspaceId: result.workspace.id,
                slug: result.workspace.slug,
                userId: result.adminUser.id
            });
    
        } catch (error) {
            console.error("Error creating company:", error);
            if (error.code === '23505') { // Postgres unique constraint violation   
                return res.status(409).json({ message: "Email or company slug already exists" });
            }
            return res.status(500).json({ message: "Internal server error" });
        }
}

export const companyLogin = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({
                message: "Email and password are required"
            });
        }
        const normalizedEmail = email.trim().toLowerCase();
        const user = await db.orm.public.User.where({email: normalizedEmail}).first();

        if (!user) {
            return res.status(404).json({
                message: "User not found"
            });
        }
        const isMatch = await bcrypt.compare(
            password,
            user.passwordHash
        );
        if (!isMatch) {
            return res.status(401).json({
                message: "Invalid email or password"
            });
        }
        genToken(user, res);
        return res.status(200).json({
            message: "User verified",
        });
    
    }
    catch(err){
        console.log(err);
        return res.status(500).json({
            message: "Internal server error from login controller"
        });
    }
}

export const sendMe = async (req, res) => {
    try {
        const token = req.cookies.user_token;
        if(!token){
            return res.status(400).json({message: "No token provided in cookies"});
        }
        const decoded = jwt.decode(token);
        if(!decoded){
            return res.status(400).json({message: "Token didn't got decoded"});
        }
        return res.status(200).json({message: "Token decoded", decoded});
    } catch (error) {
            return res.status(500).json({message: "Internal server error while gettin jwt token for user"});
        
    }

}