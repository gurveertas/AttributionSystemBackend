import {db} from '../src/prisma/db.js';

export const getIndustryList = async (req, res) => {
    try {
        const industries = await db.orm.public.Industry.all();
        return res.status(200).json({
            industries: industries.map(industry => ({
                id: industry.id,
                name: industry.name
            }))
        });
    } catch (error) {
        console.error("getIndustryList:", error.message);
        return res.status(500).json({
            message: "Could not get industry list.",
        });
    }
}

export const getPaymentMethod = async (req, res) => {
    try {
        const paymentgateways = await db.orm.public.PaymentGateway.all();
        return res.status(200).json({
            paymentgateways: paymentgateways.map(gateway => ({
                id: gateway.id,
                name: gateway.name
            }))
        });
    } catch (error) {
        console.error("getIndustryList:", error.message);
        return res.status(500).json({
            message: "Could not get industry list.",
        });
    }
}

export const addIndustry = async (req, res) => {
    try {
        const { name } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({
                message: "Industry name is required."
            });
        }

        const industry = await db.orm.public.Industry.create({
            name: name.trim()
        });

        return res.status(201).json({
            message: "Industry added successfully.",
            industry: {
                id: industry.id,
                name: industry.name
            }
        });
    } catch (error) {
        console.error("addIndustry:", error.message);
        return res.status(500).json({
            message: "Could not add industry."
        });
    }
};

export const addPaymentGateway = async (req, res) => {
    try {
        const { name } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({
                message: "Payment gateway name is required."
            });
        }

        const gateway = await db.orm.public.PaymentGateway.create({
            name: name.trim()
        });

        return res.status(201).json({
            message: "Payment gateway added successfully.",
            paymentgateway: {
                id: gateway.id,
                name: gateway.name
            }
        });
    } catch (error) {
        console.error("addPaymentGateway:", error.message);
        return res.status(500).json({
            message: "Could not add payment gateway."
        });
    }
};