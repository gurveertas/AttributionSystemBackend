import jwt from 'jsonwebtoken'
import ENV from '../utils/env.js'
export const genToken = (user, res) => {
    const payload = {
        id : user.id,
        role : user.role,
        name : user.name,
        email : user.email
    }
    const token = jwt.sign(payload, ENV.JWT_SECRET, {expiresIn : '15m'});
    res.cookie("user_token", token, {
        httpOnly: true,
        secureSite: 'none',
        secure: true,
        sameSite : 'lax',
        expiresIn : 7 * 24 * 60 * 60 * 1000
    });
    return token;
}
export default genToken;