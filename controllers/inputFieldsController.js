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
        const paymentgateways = db.orm.public.PaymentGateway.all();
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