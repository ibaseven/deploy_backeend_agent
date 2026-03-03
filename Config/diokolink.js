// Config/diokolink.js
require("dotenv").config();

// ✅ CONFIGURATION DIOKOLINK
const DIOKOLINK_CONFIG = {
  // Clés API DiokoLink depuis les variables d'environnement
  SECRET_KEY: process.env.DIOKOLINK_SECRET_KEY,
  WEBHOOK_SECRET: process.env.DIOKOLINK_WEBHOOK_SECRET,

  // Environnement (test ou live)
  ENVIRONMENT: process.env.DIOKOLINK_ENV || 'test',

  // URLs de l'API
  BASE_URL: 'https://diokolink.com/api/v1',

  // ✅ ENDPOINTS DiokoLink
  ENDPOINTS: {
    // Paiements (Collection)
    INITIALIZE_PAYMENT: '/payments/initialize',
    GET_PAYMENTS: '/payments',
    GET_PAYMENT: '/payments', // + /{transactionId}
    CALCULATE_FEES: '/payments/calculate-fees',

    // Décaissements (Payouts)
    INITIALIZE_PAYOUT: '/payouts/initialize',
    GET_PAYOUTS: '/payouts',
    GET_PAYOUT: '/payouts', // + /{transactionId}
    CALCULATE_PAYOUT_FEES: '/payouts/calculate-fees',

    // Support
    GET_PAYMENT_METHODS: '/payment-methods',
    GET_BALANCE: '/balance',
    GET_BALANCE_MOVEMENTS: '/balance/movements',
  },

  // ✅ URLs de callback adaptées à votre domaine
  CALLBACK_URL: process.env.BACKEND_URL || 'https://api.actionnaire.diokoclient.com',
  RETURN_URL: process.env.FRONTEND_URL || 'https://actionnaire.diokoclient.com',

  // Informations de l'entreprise Dioko
  MERCHANT_INFO: {
    name: "Dioko",
    description: "Plateforme d'investissement en actions",
    phone: process.env.COMPANY_PHONE || "221775968426",
    email: process.env.COMPANY_EMAIL || "contact@dioko.com",
    website: process.env.FRONTEND_URL || "https://actionnaire.diokoclient.com"
  }
};

// ✅ VALIDATION DE LA CONFIGURATION
const validateConfig = () => {
  const required = ['SECRET_KEY'];
  const missing = required.filter(key => !DIOKOLINK_CONFIG[key]);

  if (missing.length > 0) {
    console.error('❌ Configuration DiokoLink manquante:', missing);
    console.error('🔍 Vérifiez ces variables dans votre fichier .env :');
    console.error('   - DIOKOLINK_SECRET_KEY=votre_secret_key');
    console.error('   - DIOKOLINK_WEBHOOK_SECRET=votre_webhook_secret (optionnel)');
    console.error('   - DIOKOLINK_ENV=test (ou live pour production)');
    throw new Error(`Configuration DiokoLink manquante: ${missing.join(', ')}`);
  }

  console.log('✅ Configuration DiokoLink validée');
  console.log(`📍 Environnement: ${DIOKOLINK_CONFIG.ENVIRONMENT}`);
  console.log(`🌐 Base URL: ${DIOKOLINK_CONFIG.BASE_URL}`);
};

// Headers pour les requêtes DiokoLink
const getHeaders = () => {
  const headers = {
    'Authorization': `Bearer ${DIOKOLINK_CONFIG.SECRET_KEY}`,
    'Content-Type': 'application/json',
    'X-Environment': DIOKOLINK_CONFIG.ENVIRONMENT
  };

  // Vérifier que les headers ne sont pas undefined
  if (!DIOKOLINK_CONFIG.SECRET_KEY) {
    console.error('❌ Secret Key DiokoLink manquante');
    throw new Error('Configuration DiokoLink invalide: SECRET_KEY manquant');
  }

  return headers;
};

// ✅ FONCTION DE DEBUG SÉCURISÉE
const debugConfig = () => {
  console.log('🔍 Debug Configuration DiokoLink:');
  console.log('SECRET_KEY:', DIOKOLINK_CONFIG.SECRET_KEY ? `${DIOKOLINK_CONFIG.SECRET_KEY.substring(0, 10)}...` : '❌ undefined');
  console.log('ENVIRONMENT:', DIOKOLINK_CONFIG.ENVIRONMENT);
  console.log('BASE_URL:', DIOKOLINK_CONFIG.BASE_URL);
  console.log('MERCHANT_INFO:', DIOKOLINK_CONFIG.MERCHANT_INFO);
  console.log('CALLBACK_URL:', `${DIOKOLINK_CONFIG.CALLBACK_URL}/actions/payment/callback`);
  console.log('RETURN_URL:', DIOKOLINK_CONFIG.RETURN_URL);
};

// ✅ FONCTION DE TEST DE CONNECTIVITÉ
const testDiokoLinkConnection = async () => {
  try {
    const axios = require('axios');
    console.log('🧪 Test de connexion DiokoLink...');

    // Test avec l'endpoint balance (authentifié)
    const fullUrl = `${DIOKOLINK_CONFIG.BASE_URL}${DIOKOLINK_CONFIG.ENDPOINTS.GET_BALANCE}`;

    const response = await axios.get(fullUrl, {
      headers: getHeaders(),
      timeout: 10000,
      validateStatus: (status) => status < 500
    });

    console.log(`✅ Serveur DiokoLink accessible - Status: ${response.status}`);

    if (response.status === 200) {
      console.log('💰 Solde:', response.data);
    }

    return {
      success: true,
      status: response.status,
      message: 'Connexion à DiokoLink établie',
      data: response.data
    };

  } catch (error) {
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      console.error('❌ Problème de connectivité réseau vers DiokoLink');
      return {
        success: false,
        error: 'Problème de connectivité réseau',
        details: error.message
      };
    }

    console.log(`🔍 Test connexion - Status: ${error.response?.status || 'unknown'}`);
    console.error('Détails erreur:', error.response?.data);

    return {
      success: false,
      status: error.response?.status || 'unknown',
      message: 'Erreur de connexion DiokoLink',
      details: error.response?.data
    };
  }
};

// ✅ HELPER POUR CONSTRUIRE LES URLs DE CALLBACK
const buildCallbackUrls = (transactionId = null) => {
  const baseCallback = `${DIOKOLINK_CONFIG.CALLBACK_URL}/actions/payment/callback`;

  return {
    callback_url: baseCallback,
    return_url: `${DIOKOLINK_CONFIG.RETURN_URL}/payment/success${transactionId ? `?transaction=${transactionId}` : ''}`,
    cancel_url: `${DIOKOLINK_CONFIG.RETURN_URL}/payment/cancel${transactionId ? `?transaction=${transactionId}` : ''}`
  };
};

// ✅ HELPER POUR VALIDER LES WEBHOOKS DIOKOLINK (sécurité)
const validateWebhookSignature = (payload, signature) => {
  if (!DIOKOLINK_CONFIG.WEBHOOK_SECRET) {
    console.warn('⚠️ WEBHOOK_SECRET non configuré - validation ignorée');
    return true;
  }

  if (!signature) {
    console.warn('⚠️ Signature webhook manquante');
    return false;
  }

  try {
    const crypto = require('crypto');
    const hmac = crypto.createHmac('sha256', DIOKOLINK_CONFIG.WEBHOOK_SECRET);
    const expectedSignature = hmac.update(JSON.stringify(payload)).digest('hex');

    return signature === expectedSignature;
  } catch (error) {
    console.error('❌ Erreur validation signature webhook:', error);
    return false;
  }
};

module.exports = {
  DIOKOLINK_CONFIG,
  validateConfig,
  getHeaders,
  debugConfig,
  testDiokoLinkConnection,
  buildCallbackUrls,
  validateWebhookSignature
};

// ✅ AUTO-VALIDATION AU CHARGEMENT DU MODULE
try {
  validateConfig();
} catch (error) {
  console.error('❌ Erreur de configuration DiokoLink:', error.message);
  // Ne pas faire planter l'application, mais logger l'erreur
}
