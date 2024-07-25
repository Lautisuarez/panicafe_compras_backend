const express = require('express');
const Sequelize = require('sequelize');
const router = express.Router();
const controllers = require('../controllers/controllers');
const middlewares = require('../middlewares/middlewares');


//Traemos los productos de la DB de mr comanda
router.get('/productos',middlewares.checkJWT, controllers.getProductos);
router.get('/rubros',middlewares.checkJWT, controllers.getRubros);
router.post('/pedidos',middlewares.checkJWT, controllers.postPedido)

router.post('/adduser',middlewares.checkJWT, middlewares.checkIfAdminJWT, middlewares.checkIsExist, controllers.addUser)
router.get('/getInfoAddUser',middlewares.checkJWT,middlewares.checkIfAdminJWT,  controllers.getInfoAddUser)
router.post('/login', controllers.login)
router.put('/editUser', middlewares.checkIfAdminJWT, middlewares.checkIsExistEdit, controllers.editUser)
router.get('/getUsers', middlewares.checkIfAdminJWT, controllers.getUsers)
router.delete('/deleteUser', middlewares.checkIfAdminJWT,middlewares.checkIsExistEdit,controllers.deleteUser)
router.post ('/mispedidos', middlewares.checkJWT, controllers.misPedidos)
router.post('/mispedidosdetalle', middlewares.checkJWT, controllers.misPedidosDetalle)


module.exports = router;
