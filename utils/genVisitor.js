import crypto from 'crypto';

const genVisitor = async (res, utm_campaign, utm_source) => {
    const visitor_id = crypto.randomUUID();
    const visitor = {
        visitor_id,
        utm_source,
        utm_campaign
    }
    res.cookie("visitor", visitor, {
        httpOnly: true,
        secure: true,
        // sameSite: '',
        maxAge: 3600 * 1000
    });
    return visitor;
}
export default genVisitor;