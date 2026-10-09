import dotenv from 'dotenv';
dotenv.config();

if (!process.env.JWT_SECRET) {
    console.log(JWT_SECRET);
    console.error("jwt secret missing from env");
    throw new Error("jwt secret missing from env");
}
if (!process.env.DB_URL) {
    console.log(DB_URL)
    console.error("DB url missing from env");
    throw new Error("DB url missing from env");
}
if (!process.env.PORT) {
    console.log(PORT)
    console.error("port missing from env");
    throw new Error("port missing from env");
}

const ENV = {
    DB_URL : process.env.DB_URL,
    JWT_SECRET : process.env.JWT_SECRET,
    PORT : 3000
}

export default ENV;