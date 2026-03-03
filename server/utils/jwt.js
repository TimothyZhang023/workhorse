import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'timo-access-secret-!!!';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'timo-refresh-secret-!!!';

export function generateAccessToken(user) {
    return jwt.sign(
        { uid: user.uid, role: user.role, username: user.username },
        JWT_SECRET,
        { expiresIn: '2h' }
    );
}

export function generateRefreshToken(user) {
    return jwt.sign(
        { uid: user.uid },
        REFRESH_SECRET,
        { expiresIn: '7d' }
    );
}

export function verifyAccessToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (e) {
        return null;
    }
}

export function verifyRefreshToken(token) {
    try {
        return jwt.verify(token, REFRESH_SECRET);
    } catch (e) {
        return null;
    }
}
