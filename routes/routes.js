const express = require('express');
const Sequelize = require('sequelize');
const router = express.Router();
const controllers = require('../controllers/controllers');
const middlewares = require('../middlewares/middlewares');


//Traemos los productos de la DB de mr comanda
router.get('/productos', controllers.getProductos); //revisarss
router.post('/pedidos', middlewares.checkPedidos, controllers.postPedido)

//router.post('/login', middlewares.checkDatos.controllers.login)
router.post('/adduser', middlewares.checkIsAdmin, middlewares.checkIsExist, controllers.addUser)
router.post('/login', controllers.login)



module.exports = router;