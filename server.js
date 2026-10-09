import express from 'express';
import cors from 'cors';
import genVisitor from './utils/genVisitor.js';
import cookieParser from 'cookie-parser';
import { db } from './src/prisma/db.js';
// import bcrypt from 'bcrypt';
// import { genSlug } from './utils/genSlug.js';
import authRoutes from './routes/authRoutes.js'


const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(cors({
  origin: "http://localhost:5173",
  credentials: true
}));

app.use('/api/auth', authRoutes);

app.get('/', (req, res) => {
    res.status(200).json({message: "Home route"});
});

app.get('/click', async (req, res) => {
    try {
        const {utm_source, utm_campaign} = req.query;
        const check = req.cookies.visitor;
        if(check){
            return res.status(400).json({message: "Visitor id already exists"});
        }
        const visitor = await genVisitor(res, utm_campaign, utm_source);
        console.log(visitor);
        console.log("Response sent");
        return res.status(200).json({message: "visitor id created and saved to cookies", visitor});
    } catch (error) {
        return res.status(500).json({message: "Internal server error"});
    }
});
app.post('/checkout', (req, res) => {
    try {
        
        if(!req.body.email){
            return res.status(400).json({message: "No email received while checkout"});
        }
        const {email} = req.body;
        const source = req.cookies.visitor;
        if(!source){
            return res.status(400).json({message: "Source not found in the cookies"});
        }
        const saveInfo = {
            email,
            source
        }
        db.orm.public.Visitor.create(saveInfo);
        return res.status(201).json({message : "checkout details created", saveInfo});
    } catch (error) {
        return res.status(500).json({message: "Internal server error"});
    }
});

// app.post('/company', async (req, res) => {
//     console.log("Storing the company credetials");
//     const {}
// })


app.listen(3000, () => {
    console.log("The server is running");
});
