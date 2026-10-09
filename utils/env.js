import dotenv from 'dotenv';
dotenv.config();

if (!process.env.DB_URL) {
    console.error("DB url missing from env");
    throw new Error("DB url missing from env");
}

const ENV = {
    DB_URL : process.env.DB_URL
}

export default ENV;