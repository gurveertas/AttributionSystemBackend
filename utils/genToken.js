import jwt from 'jsonwebtoken'
import ENV from '../utils/env.js'
export const genToken = (user, res) => {
    try {
        const payload = {
        id : user.id,
        role : user.role,
        name : user.name,
        email : user.email
    }
    const token = jwt.sign(payload, ENV.JWT_SECRET, {expiresIn : '15m'});
    res.cookie("user_token", token, {
        secure: true,
        sameSite : 'lax',
        expiresIn : 7 * 24 * 60 * 60 * 1000
    });
    } catch (error) {
        return res.status(500).json('Internal server error while generating cookie');
    }
    
}
export default genToken;