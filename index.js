const express = require('express');
const swaggerUi = require('swagger-ui-express');
const swaggerJsDoc = require('swagger-jsdoc');
const cors = require('cors');
const bodyParser = require('body-parser');
const routes = require('./routes/routes');

// Configuración de Swagger
const swaggerOptions = {
    swaggerDefinition: {
        openapi: '3.0.0',
        info: {
            title: 'API Example',
            version: '1.0.0',
            description: 'API documentation using Swagger',
        },
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                },
            },
        },
        security: [{ bearerAuth: [] }],
        tags: [
            {
                name: 'Productos',
                description: 'Endpoints relacionados con productos',
            },
            {
                name: 'Usuarios',
                description: 'Endpoints relacionados con usuarios',
            },
            {
                name: 'Pedidos',
                description: 'Endpoints relacionados con pedidos',
            },
        ],
    },
    apis: ['./routes/*.js'],
};

// Inicializar la aplicación
const app = express();

// Middleware
const corsOptions = {
    origin: '*',
    optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(bodyParser.json());

// Configurar Swagger UI
const swaggerDocs = swaggerJsDoc(swaggerOptions);
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Rutas de la API
app.use('/', routes);

// Inicializar el servidor
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    const t = new Date();
    const z = t.getTimezoneOffset() * 60 * 1000;
    const tLocal = new Date(t - z);
    const date = tLocal.toISOString().slice(0, 19).replace('T', ' ');

    console.log(`Servidor inicializado en el puerto ${PORT} a las ${date}`);
});
