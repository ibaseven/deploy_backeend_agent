require('dotenv').config();
const express = require("express")
const cors = require("cors")
const morgan = require("morgan");
const cookieParser = require('cookie-parser');
const bodyParser = require("body-parser");
const routes = require("./Routes/routes");
const connectDB = require("./Config/db");
const path = require('path'); // ← Ajoutez cette ligne

const app = express();
// ✅ Nécessaire pour récupérer la vraie IP derrière Traefik (ou tout reverse proxy)
app.set('trust proxy', 1);
connectDB();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS',"PATCH"],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(morgan("combined"));
app.use(cookieParser());

// ✅ AJOUTEZ CETTE LIGNE : Servir les fichiers temporaires
app.use('/temp', express.static(path.join(__dirname, 'temp')));
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/", routes);

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

app.use('/', (req, res) => {
    res.send(`<h1>Welcome </h1>`)
})

const port = process.env.PORT;
app.listen(port, () => {
    console.log(`Server running on port ${port}...`);
});