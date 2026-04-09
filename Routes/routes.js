const express = require('express');
const { signUP, initiateSignIn, verifyOTPAndSignIn, createAccount, checkAndGetUserByToken, getMyActions, updateUser, getAllActionnaires, toggleActionnaireStatus, getBeneficesEntreprise, getMyActionnaireInfo, getMyParrainageInfo, setMyParrain, resetPassWord, getOtherUsers, getUserById, changePassword, sendPasswordResetOTP, verifyOTPAndResetPassword, resendPasswordResetOTP, deleteUser, deleteMultipleUsers, signForNewActionnaire, verifyOTPAndCreateAccount, resendSignUpOTP, updateOwnProfile } = require('../Controller/UserControler');
const { createEntreprise, addNewYearBenefices, downloadRapport, updateAllDividendesFrom2025 } = require('../Controller/entrepriseController');
const { diagnosePDF, bulkImportFromFile, bulkImportFromJSON, getImportStatus,previewPDF } = require('../Controller/bulkImportController');
const { getDividendBalance, getDividendWithdrawalHistory, initiateDividendWithdrawal, confirmDividendWithdrawal, getTransactions, initiateDividendWithdrawalAdmin, confirmDividendWithdrawalAdmin } = require('../Controller/DividendController');
const authenticateToken = require('../Middlewares/authenticateToken');
const { uploadImg } = require('../Middlewares/awsUpload');
const { addProjection, getAllProjections, projectFuture } = require('../Controller/projectionController');
const {
  createProject,
  updateProject,
  deleteProject,
  getAllProjectsAdmin,
  getProjectByIdAdmin,
  getProjectsStats,
  updateInvestmentStatus,
  getOpenProjects,
  getProjectById,
  investInProject,
  checkInvestmentPaymentStatus,
  getMyInvestments
} = require('../Controller/projectController');

// ✅ IMPORT CORRIGÉ - Utilisez le bon nom de fichier avec majuscule
const {
  initiateActionsPurchase,
  checkPaymentStatus,
  getAllTransactions,
  getSalesStatistics,
  getMyActionsPurchaseHistory,
  handlePaydunyaCallback
} = require('../Controller/actionsPurchaseController'); // ✅ CORRIGÉ: Majuscule

// ✅ IMPORT CALLBACK PAYDUNYA


const { getActionsPurchaseOptions, simulateActionsPurchaseWithDividends, purchaseActionsWithDividends, getDividendPurchaseHistory } = require('../Controller/dividendPurchaseController');
const { rejectSaleRequest, approveSaleRequest, getAllSaleRequests, getMySaleRequests, createSaleRequest } = require('../Controller/ActionsSaleController');
const { verifyOTPForPartner, resendOTPForPartner } = require('../Controller/otpController');
const { buydividendeswithoseruser, getTransactionsForTest, updateTransactionStatusForTest, getAllDividendesbuywithOtherUser } = require('../Controller/ActionsSaleUser');
const { getAllPrices, getPriceByType, upsertPrice, deletePrice, getAllVIPUsers, addVIPUser, removeVIPUser, checkVIPStatus } = require('../Controller/priceController');
const { getAllAuthorizedSellers, addAuthorizedSeller, removeAuthorizedSeller, toggleAuthorizedSeller } = require('../Controller/authorizedSellerController');
const { initiateInstallmentPurchase, addInstallmentPayment, getMyInstallmentPurchases, getMyInstallmentHistory, annulerContratVersement } = require('../Controller/installmentPurchaseController');
const { requestCryptoWithdrawal, getMyCryptoWithdrawals, getAllCryptoWithdrawals, acceptCryptoWithdrawal, rejectCryptoWithdrawal } = require('../Controller/cryptoWithdrawalController');
const { getAvailablePacks, initiatePackPurchaseCFA, handlePackPaydunyaCallback, checkPackPaymentStatus, initiatePackPurchaseCrypto, getMyPackPurchases, getAllPackPurchases, validatePackPurchase, rejectPackPurchase } = require('../Controller/packPurchaseController');



const {
  getMoratoriumStatus,
  getUserWaitingPurchases,
  annulerAchatMoratorium,
  activerMoratoire,
  desactiverMoratoire,
  validerMoratoire,
  getWaitingPurchases,
  getParticipants,
  getMoratoriumStats,
  ajouterAchatMoratoriumManuel
} = require('../Controller/moratoriumController');

const uploadFields = [
  { name: 'rapport', maxCount: 3 }
];

const router = express.Router();

// ===============================================
// 📊 ROUTES ACTIONS - NETTOYÉES ET ORGANISÉES
// ===============================================

// Route publique - Prix des actions
//router.get('/actions/prix-actuel', getCurrentActionPrice);

// Routes utilisateur authentifié
router.post('/actions/acheter', authenticateToken.authenticate, initiateActionsPurchase);
router.get('/actions/historique', authenticateToken.authenticate, getMyActionsPurchaseHistory);
router.get('/actions/transaction/:transactionId/status', authenticateToken.authenticate, checkPaymentStatus);

// Routes admin actions
router.get('/actions/admin/transactions', authenticateToken.authenticate, authenticateToken.requireAdmin, getAllTransactions);
router.get('/actions/admin/statistiques', authenticateToken.authenticate, authenticateToken.requireAdmin, getSalesStatistics);

router.post('/sellActionsBetweenUser', authenticateToken.authenticate, buydividendeswithoseruser);
router.get("/actions/sellActionsBetweenUser", authenticateToken.authenticate,getAllDividendesbuywithOtherUser);
// ===============================================
// 🔔 ROUTES CALLBACK PAYDUNYA
// ===============================================

// ✅ ROUTE PRINCIPALE - Callback PayDunya (public, pas d'auth)
router.post('/actions/payment/callback', handlePaydunyaCallback);

// Routes de vérification de transactions
//router.get('/actions/payment/transaction/:transactionId/status', authenticateToken.authenticate, checkTransactionStatus);

// Routes admin callback
//router.post('/actions/payment/transaction/:transactionId/sync', authenticateToken.authenticate, authenticateToken.requireAdmin, forceSyncTransaction);
//router.get('/actions/payment/logs', authenticateToken.authenticate, authenticateToken.requireAdmin, getCallbackLogs);

// Routes de test
//router.post('/actions/payment/test-webhook', testWebhook);
//router.get('/actions/payment/test-webhook', testWebhook);
router.post('/actions/versements/creer-contrat', authenticateToken.authenticate, initiateInstallmentPurchase);
router.post('/actions/versements/payer', authenticateToken.authenticate, addInstallmentPayment);
router.get('/actions/versements/mes-achats', authenticateToken.authenticate, getMyInstallmentPurchases);
router.get('/actions/versements/historique', authenticateToken.authenticate, getMyInstallmentHistory);
router.delete('/actions/versements/:contractId', authenticateToken.authenticate, annulerContratVersement);

// ===============================================
// 💰 ROUTES ACHAT AVEC DIVIDENDES
// ===============================================

router.get('/actions/options', authenticateToken.authenticate, getActionsPurchaseOptions);
router.post('/actions/simulate', authenticateToken.authenticate, simulateActionsPurchaseWithDividends);
router.post('/actions/acheter-dividendes', authenticateToken.authenticate, purchaseActionsWithDividends);
router.get('/actions/historique-dividendes', authenticateToken.authenticate, authenticateToken.requireAdmin, getDividendPurchaseHistory);

// ===============================================
// ⏳ ROUTES MORATOIRE (ACHAT PAR PALIERS)
// ===============================================

router.get('/moratoire/status',authenticateToken.authenticate, getMoratoriumStatus);
router.get('/moratoire/mes-achats-en-attente', authenticateToken.authenticate, getUserWaitingPurchases);
router.delete('/moratoire/mes-achats/:moratoriumId', authenticateToken.authenticate, annulerAchatMoratorium);
router.post('/moratoire/activer', authenticateToken.authenticate, authenticateToken.requireAdmin, activerMoratoire);
router.post('/moratoire/desactiver', authenticateToken.authenticate, authenticateToken.requireAdmin, desactiverMoratoire);
router.post('/moratoire/valider', authenticateToken.authenticate, authenticateToken.requireAdmin, validerMoratoire);
router.get('/moratoire/achats-en-attente', authenticateToken.authenticate, authenticateToken.requireAdmin, getWaitingPurchases);
router.get('/moratoire/participants', authenticateToken.authenticate, authenticateToken.requireAdmin, getParticipants);
router.get('/moratoire/statistiques', authenticateToken.authenticate, authenticateToken.requireAdmin, getMoratoriumStats);
router.post('/moratoire/ajouter-manuel', authenticateToken.authenticate, authenticateToken.requireAdmin, ajouterAchatMoratoriumManuel);

// ===============================================
// 💳 ROUTES ACHAT PAR VERSEMENTS (PAIEMENTS ÉCHELONNÉS)
// ===============================================

// Routes utilisateur
router.post('/actions/versements/creer-contrat', authenticateToken.authenticate, initiateInstallmentPurchase);
router.post('/actions/versements/payer', authenticateToken.authenticate, addInstallmentPayment);
router.get('/actions/versements/mes-achats', authenticateToken.authenticate, getMyInstallmentPurchases);
router.get('/actions/versements/historique', authenticateToken.authenticate, getMyInstallmentHistory);

// Route admin versements
//router.get('/actions/versements/admin/tous', authenticateToken.authenticate, authenticateToken.requireAdmin, getAllInstallmentPurchases);

// ===============================================
// 👥 ROUTES UTILISATEURS (EXISTANTES)
// ===============================================

router.post("/signup", signUP);
router.post("/api/auth/signup/initiate", signForNewActionnaire);
router.post("/api/auth/signup/verify", verifyOTPAndCreateAccount);
router.post("/api/auth/signup/resend-otp ", resendSignUpOTP);

router.post("/auth/signin", initiateSignIn);
router.post("/auth/verify-otp", verifyOTPAndSignIn);
router.post("/createActionnaire", createAccount);
router.get('/verify-token/:token', checkAndGetUserByToken);
router.get('/users/my-actions', authenticateToken.authenticate, getMyActions);
router.get('/transactions', authenticateToken.authenticate, getTransactions);
router.post('/change-password', changePassword);

// ===============================================
// 🏢 ROUTES ENTREPRISEnhjhj
// ===============================================
router.post('/verify-otp', authenticateToken.authenticate, verifyOTPForPartner);
router.post('/resend-otp', authenticateToken.authenticate, resendOTPForPartner);
router.post("/CreateEntreprise", createEntreprise);
router.post("/entreprises/new-year", authenticateToken.authenticate, authenticateToken.requireAdmin, uploadImg(uploadFields), addNewYearBenefices);
router.get("/entreprises/download/:fileName", downloadRapport);
router.get('/actionnaire/benefices-entreprise', authenticateToken.authenticate, getBeneficesEntreprise);
router.get('/actionnaire/mes-informations', authenticateToken.authenticate, getMyActionnaireInfo);
router.get('/actionnaire/parrainage', authenticateToken.authenticate, getMyParrainageInfo);
router.post('/actionnaire/parrainage', authenticateToken.authenticate, setMyParrain);

// ===============================================
// 👑 ROUTES ADMIN
// ===============================================

router.get('/admin/actionnaires', authenticateToken.authenticate, authenticateToken.requireAdmin, getAllActionnaires);
router.post('/admin/actionnaires/toggle-status', authenticateToken.authenticate, authenticateToken.requireAdmin, toggleActionnaireStatus);
router.put('/api/admin/users/:userId', authenticateToken.authenticate, authenticateToken.requireAdmin, updateUser);
router.put('/admin/update-dividendes/2025', updateAllDividendesFrom2025);
router.delete('/deleteUsers/:userId', authenticateToken.authenticate, authenticateToken.requireAdmin, deleteUser);
router.delete('/deleteMultipleUsers/batch', authenticateToken.authenticate, authenticateToken.requireAdmin, deleteMultipleUsers);

// ===============================================
// 💳 ROUTES DIVIDENDES
// ===============================================

router.get("/dividends/balance", getDividendBalance);
router.get("/dividends/history", authenticateToken.authenticate, authenticateToken.requireAdmin, getDividendWithdrawalHistory);
router.post("/dividends/withdraw/initiate", authenticateToken.authenticate, initiateDividendWithdrawal);
router.post("/dividends/withdraw/confirm", authenticateToken.authenticate, confirmDividendWithdrawal);

router.post("/dividends/withdrawAdmin/initiate", authenticateToken.authenticate, initiateDividendWithdrawalAdmin);
router.post("/dividends/withdrawAdmin/confirm", authenticateToken.authenticate, confirmDividendWithdrawalAdmin);

// ===============================================
// 🔒 ROUTES MOT DE PASSE
// ===============================================

router.post('/request-password-reset', sendPasswordResetOTP);
router.post('/verify-reset-otp', verifyOTPAndResetPassword);
router.post('/resend-reset-otp', resendPasswordResetOTP);
router.post("/reset-password/:resetToken", resetPassWord);

// ===============================================
// 📊 ROUTES PROJECTIONS
// ===============================================

router.post("/projections/addPrevision", addProjection);
router.get("/projections/getPrevision", getAllProjections);
router.post("/projections/project-future", projectFuture);

// ===============================================
// 📄 ROUTES IMPORT EN MASSE
// ===============================================

router.post("/bulk-import/diagnose", diagnosePDF);
router.post("/bulk-import/preview", previewPDF);
router.post("/bulk-import/file", bulkImportFromFile);
router.post("/bulk-import/json", bulkImportFromJSON);
router.get("/bulk-import/status", getImportStatus);

// ===============================================
// 🔍 ROUTES AUTRES
// ===============================================

router.get("/other-users", authenticateToken.authenticateTokenAndUserData, getOtherUsers);
router.get("/get-user/:id", getUserById);


router.post('/create', authenticateToken.authenticate, createSaleRequest);
router.get('/myRequestToSellAction',authenticateToken.authenticate, getMySaleRequests);

// Routes pour l'administrateur
router.get('/GetallActionToSell', authenticateToken.authenticate, getAllSaleRequests);
router.put('/approve/:demandeId', authenticateToken.authenticate, approveSaleRequest);
router.put('/reject/:demandeId', authenticateToken.authenticate, rejectSaleRequest);
//router.get('/statistics', authenticateToken.authenticateTokenAndUserData, getSalesStatistics);
//les testr

router.put('/updateProfile', authenticateToken.authenticate, updateOwnProfile);
//router.get('/test/transactions', getTransactionsForTest);

// Mettre à jour le statut pour test
router.post('/test/update-status', updateTransactionStatusForTest);

// Routes pour les prix
router.get('/prices',authenticateToken.authenticate, getAllPrices);
router.get('/prices/:type', authenticateToken.authenticate,getPriceByType);
router.post('/prices',authenticateToken.authenticate,authenticateToken.requireAdmin,upsertPrice); // Ajouter protect, authorize('admin')
router.delete('/prices/:type',authenticateToken.authenticate, authenticateToken.requireAdmin,deletePrice); // Ajouter protect, authorize('admin')

// Routes pour les utilisateurs VIP
router.get('/vip-users',authenticateToken.authenticate, getAllVIPUsers);
router.post('/vip-users',authenticateToken.authenticate,authenticateToken.requireAdmin, addVIPUser); // Ajouter protect, authorize('admin')
router.delete('/vip-users/:telephone',authenticateToken.authenticate, authenticateToken.requireAdmin,removeVIPUser); // Ajouter protect, authorize('admin')
router.get('/vip-users/check/:telephone', authenticateToken.authenticate,checkVIPStatus);

// ===============================================
// 🏷️ ROUTES VENDEURS AUTORISÉS
// ===============================================
router.get('/authorized-sellers', authenticateToken.authenticate, authenticateToken.requireAdmin, getAllAuthorizedSellers);
router.post('/authorized-sellers', authenticateToken.authenticate, authenticateToken.requireAdmin, addAuthorizedSeller);
router.delete('/authorized-sellers/:telephone', authenticateToken.authenticate, authenticateToken.requireAdmin, removeAuthorizedSeller);
router.put('/authorized-sellers/:telephone/toggle', authenticateToken.authenticate, authenticateToken.requireAdmin, toggleAuthorizedSeller);

// ===============================================
// 📁 ROUTES PROJETS D'INVESTISSEMENT
// ===============================================

// Admin - Gestion des projets
const uploadProjectFields = [
  { name: 'logo', maxCount: 1 },
  { name: 'rapport', maxCount: 1 }
];
router.post('/admin/projets', authenticateToken.authenticate, authenticateToken.requireAdmin, uploadImg(uploadProjectFields), createProject);
router.put('/admin/projets/:projectId', authenticateToken.authenticate, authenticateToken.requireAdmin, uploadImg(uploadProjectFields), updateProject);
router.delete('/admin/projets/:projectId', authenticateToken.authenticate, authenticateToken.requireAdmin, deleteProject);
router.get('/admin/projets', authenticateToken.authenticate, authenticateToken.requireAdmin, getAllProjectsAdmin);
router.get('/admin/projets/statistiques', authenticateToken.authenticate, authenticateToken.requireAdmin, getProjectsStats);
router.get('/admin/projets/:projectId', authenticateToken.authenticate, authenticateToken.requireAdmin, getProjectByIdAdmin);
router.put('/admin/investissements/:investmentId/statut', authenticateToken.authenticate, authenticateToken.requireAdmin, updateInvestmentStatus);

// Actionnaire - Consultation & investissement
router.get('/projets', authenticateToken.authenticate, getOpenProjects);
router.get('/projets/:projectId', authenticateToken.authenticate, getProjectById);
router.post('/projets/:projectId/investir', authenticateToken.authenticate, investInProject);
router.get('/investissements/:investmentId/statut', authenticateToken.authenticate, checkInvestmentPaymentStatus);
router.get('/mes-investissements', authenticateToken.authenticate, getMyInvestments);

// ===============================================
// 📦 ROUTES PACKS D'ACTIONS
// ===============================================

router.get('/packs', authenticateToken.authenticate, getAvailablePacks);
router.post('/packs/acheter-cfa', authenticateToken.authenticate, initiatePackPurchaseCFA);
router.post('/packs/callback', handlePackPaydunyaCallback); // public — PayDunya
router.get('/packs/transaction/:token/status', authenticateToken.authenticate, checkPackPaymentStatus);
router.post('/packs/acheter-crypto', authenticateToken.authenticate, initiatePackPurchaseCrypto);
router.get('/packs/mes-achats', authenticateToken.authenticate, getMyPackPurchases);
router.get('/packs/admin/achats', authenticateToken.authenticate, authenticateToken.requireAdmin, getAllPackPurchases);
router.put('/packs/admin/achats/:id/valider', authenticateToken.authenticate, authenticateToken.requireAdmin, validatePackPurchase);
router.put('/packs/admin/achats/:id/rejeter', authenticateToken.authenticate, authenticateToken.requireAdmin, rejectPackPurchase);

// ===============================================
// 💎 ROUTES RETRAIT CRYPTO (USDT TRC20)
// ===============================================

// Actionnaire
router.post('/crypto/retrait', authenticateToken.authenticate, requestCryptoWithdrawal);
router.get('/crypto/mes-retraits', authenticateToken.authenticate, getMyCryptoWithdrawals);

// Admin
router.get('/crypto/admin/retraits', authenticateToken.authenticate, authenticateToken.requireAdmin, getAllCryptoWithdrawals);
router.put('/crypto/admin/retraits/:id/accepter', authenticateToken.authenticate, authenticateToken.requireAdmin, acceptCryptoWithdrawal);
router.put('/crypto/admin/retraits/:id/rejeter', authenticateToken.authenticate, authenticateToken.requireAdmin, rejectCryptoWithdrawal);

module.exports = router;