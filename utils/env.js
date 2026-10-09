import dotenv from 'dotenv';
dotenv.config();

if (!process.env.JWT_SECRET) {
    console.error("jwt secret missing from env");
    throw new Error("jwt secret missing from env");
}
if (!process.env.DATABASE_PUBLIC_URL) {
    console.error("DB url missing from env");
    throw new Error("DB url missing from env");
}
if (!process.env.PORT) {
    console.error("port missing from env");
    throw new Error("port missing from env");
}

const ENV = {
    DATABASE_PUBLIC_URL : process.env.DATABASE_PUBLIC_URL,
    JWT_SECRET : process.env.JWT_SECRET,
    PORT : 3000
}

export default ENV;