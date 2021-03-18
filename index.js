const express = require('express');

const cors = require('cors')

const bodyParser = require('body-parser');

const routes = require('./routes/routes');

//Express
const server = express ();
var corsOptions = {
    origin: 'http://localhost:3000',
    optionsSuccessStatus: 200 // For legacy browser support
}
server.use(cors(corsOptions))

//Inicializar servidor
server.listen(3001, () => {
    t = new Date()
    z = t.getTimezoneOffset() * 60 * 1000
    tLocal = t-z
    tLocal = new Date(tLocal)
    date = tLocal.toISOString()
    date = date.slice(0, 19)
    date = date.replace('T', ' ')


    console.log("Server initialized at port 3001 " + date);
})
//Middlewares
server.use(bodyParser.json());

//Routes Handler 
server.use('/', routes);
