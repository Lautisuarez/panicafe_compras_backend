const express = require('express');
const Sequelize = require('sequelize');
const router = express.Router();
const controllers = require('../controllers/controllers');
const middlewares = require('../middlewares/middlewares');


//Traemos los productos de la DB de mr comanda
router.get('/productos',middlewares.checkJWT, controllers.getProductos);
router.post('/pedidos',middlewares.checkJWT, controllers.postPedido)

router.post('/adduser',middlewares.checkJWT, middlewares.checkIsAdmin, controllers.addUser)
router.get('/getInfoAddUser',middlewares.checkJWT,middlewares.checkIfAdminJWT,  controllers.getInfoAddUser)
router.post('/login', controllers.login)

// ENDPOINTS QUE FALTAN ABM USUARIOS 
// Por cada tarea un PR, es decir una branch para cada endpoint.
// git checkout -b "feat/<Nombre>"
// git add, git commit, git push
// Merge request, su_branch -> master

// - Validar que el usuario no exista cuando se crea uno nuevo (que sea unico)(que sea todo en minuscula, validar en mongodb)
// - Obtener usuarios para devolver listado
// - Cambiar contraseña --> Yo te mando el id de usuario 
// - Eliminar usuario

module.exports = router;
