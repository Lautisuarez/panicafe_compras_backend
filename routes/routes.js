const express = require('express');
const router = express.Router();
const controllers = require('../controllers');
const middlewares = require('../middlewares/middlewares');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

/**
 * @swagger
 * tags:
 *   name: Productos
 *   description: Endpoints relacionados con productos
 */

/**
 * @swagger
 * /productos:
 *   get:
 *     summary: Obtener productos
 *     tags: [Productos]
 *     security:
 *       - bearerAuth: [] 
 *     responses:
 *       200:
 *         description: Lista de productos obtenida correctamente
 *       401:
 *         description: No autorizado
 */
router.get('/productos', middlewares.checkJWT, controllers.getProductos);

/**
 * @swagger
 * /productos/admin:
 *   get:
 *     summary: Listar articulos elegibles para web (admin), con flag permitePedidoCompras
 *     description: Mismos filtros que GET /productos para SEVENDE, INVISIBL y WEB; no filtra por PERMITE_PEDIDO_COMPRAS. Requiere isAdmin 1 o 3.
 *     tags: [Productos]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de articulos web con flag permitePedidoCompras
 *       401:
 *         description: No autorizado
 */
router.get(
  '/productos/admin',
  middlewares.checkJWT,
  middlewares.checkIfAdmin1Or3JWT,
  controllers.getProductos
);

/**
 * @swagger
 * /rubros:
 *   get:
 *     summary: Obtener rubros
 *     tags: [Productos]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de rubros obtenida correctamente
 *       401:
 *         description: No autorizado
 */
router.get('/rubros', middlewares.checkJWT, controllers.getRubros);

/**
 * @swagger
 * /articulos/pedido-habilitado:
 *   patch:
 *     summary: Habilitar o deshabilitar un articulo para pedidos
 *     tags: [Productos]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - codigo
 *               - habilitado
 *             properties:
 *               codigo:
 *                 type: integer
 *                 description: Codigo del articulo
 *                 example: 1234
 *               habilitado:
 *                 type: boolean
 *                 description: Estado para permitir agregar al pedido
 *                 example: true
 *     responses:
 *       200:
 *         description: Estado del articulo actualizado
 *       400:
 *         description: Datos inválidos
 *       401:
 *         description: No autorizado
 *       404:
 *         description: Articulo no encontrado
 */
router.patch(
  '/articulos/pedido-habilitado',
  middlewares.checkJWT,
  middlewares.checkIfAdmin1Or3JWT,
  controllers.patchArticuloPedidoHabilitado
);

/**
 * @swagger
 * /pedidos:
 *   post:
 *     summary: Crear un pedido
 *     tags: [Pedidos]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Pedido creado correctamente
 *       401:
 *         description: No autorizado
 */
router.post('/pedidos', middlewares.checkJWT, controllers.postPedido);


/**
 * @swagger
 * /login:
 *   post:
 *     summary: Iniciar sesión
 *     tags: [Usuarios]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               usuario:
 *                 type: string
 *                 description: Nombre de usuario
 *                 example: johndoe
 *               pass:
 *                 type: string
 *                 description: Contraseña del usuario
 *                 example: 123456
 *     responses:
 *       200:
 *         description: Inicio de sesión exitoso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                   description: Token de autenticación
 *       401:
 *         description: Credenciales incorrectas
 */
router.post('/login', controllers.login);


/**
 * @swagger
 * /adduser:
 *   post:
 *     summary: Agregar un nuevo usuario
 *     tags: [Usuarios]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: int
 *                 description: ID del usuario nuevo
 *                 example: 1
 *               isAdmin:
 *                 type: int
 *                 description: 0 (Usuario), 1 (Admin), 2 (Production), 3 (Catálogo compras / habilitación pedidos)
 *                 example: 0
 *               usuario:
 *                 type: string
 *                 description: Nombre de usuario
 *                 example: johndoe
 *               pass:
 *                 type: string
 *                 description: Contraseña del usuario
 *                 example: 123456
 *               nombre:
 *                 type: string
 *                 description: nombre del usuario
 *                 example: john
 *               email:
 *                 type: string
 *                 description: Email del usuario
 *                 example: john@mail.com
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Usuario agregado correctamente
 *       401:
 *         description: No autorizado
 */
router.post('/adduser', middlewares.checkJWT, middlewares.checkIfAdminJWT, middlewares.checkIsExist, controllers.addUser);

/**
 * @swagger
 * /getInfoAddUser:
 *   get:
 *     summary: Obtener información para agregar un usuario
 *     tags: [Usuarios]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Información obtenida correctamente
 *       401:
 *         description: No autorizado
 */
router.get('/getInfoAddUser', middlewares.checkJWT, middlewares.checkIfAdminJWT, controllers.getInfoAddUser);


/**
 * @swagger
 * /editUser:
 *   put:
 *     summary: Editar un usuario
 *     tags: [Usuarios]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Usuario editado correctamente
 *       401:
 *         description: No autorizado
 */
router.put('/editUser', middlewares.checkIfAdminJWT, middlewares.checkIsExistEdit, controllers.editUser);

/**
 * @swagger
 * /getUsers:
 *   get:
 *     summary: Obtener lista de usuarios
 *     tags: [Usuarios]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de usuarios obtenida correctamente
 *       401:
 *         description: No autorizado
 */
router.get('/getUsers', middlewares.checkIfProductionOrAdminJWT, controllers.getUsers);

/**
 * @swagger
 * /pedidos/user:
 *   get:
 *     summary: Obtener pedidos del usuario
 *     tags: [Pedidos]
 *     parameters:
 *       - in: query
 *         name: usuario
 *         required: true
 *         description: Nombre de usuario
 *         schema:
 *           type: string
 *           example: johndoe
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pedidos del usuario obtenidos correctamente
 *       401:
 *         description: No autorizado
 */
router.get('/pedidos/user', middlewares.checkJWT, middlewares.checkIfProductionJWT, controllers.pedidoPorUsuario);

/**
 * @swagger
 * /pedidos/detalle:
 *   get:
 *     summary: Obtener los detalles de los pedidos
 *     tags: [Pedidos]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Detalle de pedidos obtenidos correctamente
 *       401:
 *         description: No autorizado
 */
router.post('/pedidos/detalle', middlewares.checkJWT, middlewares.checkIfProductionJWT, controllers.pedidosDetalle);

/**
 * @swagger
 * /deleteUser:
 *   delete:
 *     summary: Eliminar un usuario
 *     tags: [Usuarios]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       204:
 *         description: Usuario eliminado correctamente
 *       401:
 *         description: No autorizado
 */
router.delete('/deleteUser', middlewares.checkIfAdminJWT, middlewares.checkIsExistEdit, controllers.deleteUser);

/**
 * @swagger
 * /mispedidos:
 *   post:
 *     summary: Obtener los pedidos del usuario autenticado
 *     tags: [Pedidos]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de pedidos del usuario obtenida correctamente
 *       401:
 *         description: No autorizado
 */
router.post('/mispedidos', middlewares.checkJWT, controllers.misPedidos);

/**
 * @swagger
 * /mispedidosdetalle:
 *   post:
 *     summary: Obtener detalles de los pedidos del usuario autenticado
 *     tags: [Pedidos]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Detalles de los pedidos obtenidos correctamente
 *       401:
 *         description: No autorizado
 */
router.post('/mispedidosdetalle', middlewares.checkJWT, controllers.misPedidosDetalle);


const invoiceAuth = [middlewares.checkJWT, middlewares.checkIfAdmin1Or4JWT];
router.get('/productos/search', ...invoiceAuth, controllers.searchProductos);
router.get('/facturas/locales', ...invoiceAuth, controllers.getInvoiceStockLocales);
router.post('/facturas/parse', ...invoiceAuth, upload.single('file'), controllers.parseInvoicePdf);
router.post('/facturas/match', ...invoiceAuth, controllers.matchInvoiceItems);
router.post('/facturas/stock', ...invoiceAuth, controllers.saveInvoiceStock);

module.exports = router;
