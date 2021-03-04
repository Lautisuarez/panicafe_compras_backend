const express = require('express');
const Sequelize = require('sequelize');
const router = express.Router();
const controllers = require('../controllers/controllers');
const middlewares = require('../middlewares/middlewares');


//Traemos los productos de la DB de mr comanda
router.get('/productos',middlewares.checkJWT, controllers.getProductos); //revisarss
router.post('/pedidos',middlewares.checkJWT, middlewares.checkPedidos, controllers.postPedido)

//router.post('/login', middlewares.checkDatos.controllers.login)
router.get('/getInfoAddUser', /*middlewares.checkJWT,*/ controllers.getInfoAddUser)
router.post('/adduser',middlewares.checkJWT, middlewares.checkIsAdmin, controllers.addUser)
router.post('/login', controllers.login)



module.exports = router;
