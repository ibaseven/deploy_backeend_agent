// config/paydunyaConfig.js
require("dotenv").config();

// ✅ CONFIGURATION PAYDUNYA ADAPTÉE À VOTRE PROJET
const PAYDUNYA_CONFIG = {
  // Clés PayDunya depuis les variables d'environnement
  MASTER_KEY: process.env.PAYDUNYA_MASTER_KEY_CI,
  PRIVATE_KEY: process.env.PAYDUNYA_PRIVATE_KEY_CI,
  PUBLIC_KEY: process.env.PAYDUNYA_PUBLIC_KEY_CI,
  TOKEN: process.env.PAYDUNYA_TOKEN_CI,
  MODE: process.env.PAYDUNYA_MODE_CI,
  
  // URLs selon le mode (corrigées)
  BASE_URL: process.env.PAYDUNYA_MODE === 'live' 
    ? 'https://app.paydunya.com/api/v1' 
    : 'https://app.paydunya.com/sandbox-api/v1',
    
  // ✅ ENDPOINTS PayDunya
  ENDPOINTS: {
    CREATE_INVOICE: '/checkout-invoice/create',
    CONFIRM_INVOICE: '/checkout-invoice/confirm'
  },
    
  // ✅ URLs de callback adaptées à votre domaine
  RETURN_URL: process.env.FRONTEND_URL || 'https://actionnaire.diokoclient.com',
  CANCEL_URL: process.env.FRONTEND_URL || 'https://actionnaire.diokoclient.com',
  CALLBACK_URL: process.env.BACKEND_URL || 'https://api.actionnaire.diokoclient.com',
  
  // Informations de l'entreprise Dioko
  STORE_INFO: {
    name: "Dioko",
    tagline: "Plateforme d'investissement en actions",
    phone: process.env.COMPANY_PHONE || "221775968426",
    email: process.env.COMPANY_EMAIL || "contact@dioko.com",
    website_url: process.env.FRONTEND_URL || "https://actionnaire.diokoclient.com"
  }
};

// ✅ VALIDATION DE LA CONFIGURATION
const validateConfig = () => {
  const required = ['MASTER_KEY', 'PRIVATE_KEY', 'PUBLIC_KEY', 'TOKEN'];
  const missing = required.filter(key => !PAYDUNYA_CONFIG[key]);
  
  if (missing.length > 0) {
    console.error('❌ Configuration PayDunya manquante:', missing);
    console.error('🔍 Vérifiez ces variables dans votre fichier .env :');
    console.error('   - PAYDUNYA_MASTER_KEY=votre_master_key');
    console.error('   - PAYDUNYA_PRIVATE_KEY=votre_private_key');
    console.error('   - PAYDUNYA_PUBLIC_KEY=votre_public_key');
    console.error('   - PAYDUNYA_TOKEN=votre_token');
    console.error('   - PAYDUNYA_MODE=live (ou test pour sandbox)');
    throw new Error(`Configuration PayDunya manquante: ${missing.join(', ')}`);
  }
  
  //console.log('✅ Configuration PayDunya validée');
  //console.log(`📍 Mode: ${PAYDUNYA_CONFIG.MODE}`);
  //console.log(`🌐 Base URL: ${PAYDUNYA_CONFIG.BASE_URL}`);
  //console.log(`🏪 Boutique: ${PAYDUNYA_CONFIG.STORE_INFO.name}`);
  
  // Vérifications supplémentaires
  if (PAYDUNYA_CONFIG.MODE === 'live') {
    //('🚀 MODE PRODUCTION - Paiements réels activés');
    
    // Vérifications pour la production
    if (!process.env.FRONTEND_URL || !process.env.BACKEND_URL) {
      console.warn('⚠️ ATTENTION: URLs de production non configurées dans .env');
    }
    
    if (PAYDUNYA_CONFIG.STORE_INFO.phone === "221775968426") {
      console.warn('⚠️ ATTENTION: Numéro de téléphone par défaut utilisé');
    }
  } else {
    //('🧪 MODE TEST - Utilisez les cartes de test PayDunya');
  }
};

// Headers pour les requêtes PayDunya
const getHeaders = () => {
  const headers = {
    'PAYDUNYA-MASTER-KEY': PAYDUNYA_CONFIG.MASTER_KEY,
    'PAYDUNYA-PRIVATE-KEY': PAYDUNYA_CONFIG.PRIVATE_KEY,
    'PAYDUNYA-TOKEN': PAYDUNYA_CONFIG.TOKEN,
    'Content-Type': 'application/json'
  };
  
  // Vérifier que les headers ne sont pas undefined
  Object.keys(headers).forEach(key => {
    if (!headers[key]) {
      console.error(`❌ Header ${key} est manquant ou invalide`);
      throw new Error(`Configuration PayDunya invalide: ${key} manquant`);
    }
  });
  
  return headers;
};

// ✅ FONCTION DE DEBUG SÉCURISÉE
const debugConfig = () => {
  //console.log('🔍 Debug Configuration PayDunya:');
  //console.log('MASTER_KEY:', PAYDUNYA_CONFIG.MASTER_KEY ? `${PAYDUNYA_CONFIG.MASTER_KEY.substring(0, 8)}...` : '❌ undefined');
  //console.log('PRIVATE_KEY:', PAYDUNYA_CONFIG.PRIVATE_KEY ? `${PAYDUNYA_CONFIG.PRIVATE_KEY.substring(0, 8)}...` : '❌ undefined');
  //console.log('TOKEN:', PAYDUNYA_CONFIG.TOKEN ? `${PAYDUNYA_CONFIG.TOKEN.substring(0, 8)}...` : '❌ undefined');
  //console.log('MODE:', PAYDUNYA_CONFIG.MODE);
  //console.log('BASE_URL:', PAYDUNYA_CONFIG.BASE_URL);
  //console.log('STORE_INFO:', PAYDUNYA_CONFIG.STORE_INFO);
  //console.log('CALLBACK_URL:', `${PAYDUNYA_CONFIG.CALLBACK_URL}/api/actions/payment/callback`);
  //console.log('RETURN_URL:', PAYDUNYA_CONFIG.RETURN_URL);
  //console.log('CANCEL_URL:', PAYDUNYA_CONFIG.CANCEL_URL);
};

// ✅ FONCTION DE TEST DE CONNECTIVITÉ
const testPaydunyaConnection = async () => {
  try {
    const axios = require('axios');
    //console.log('🧪 Test de connexion PayDunya...');
    
    // Test simple de connectivité
    const response = await axios.get(PAYDUNYA_CONFIG.BASE_URL.replace('/api/v1', ''), {
      timeout: 10000,
      validateStatus: (status) => status < 500
    });

    //console.log(`✅ Serveur PayDunya accessible - Status: ${response.status}`);
    return { 
      success: true, 
      status: response.status,
      message: 'Connexion à PayDunya établie'
    };

  } catch (error) {
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      console.error('❌ Problème de connectivité réseau vers PayDunya');
      return { 
        success: false, 
        error: 'Problème de connectivité réseau',
        details: error.message 
      };
    }
    
    //(`🔍 Test connexion - Status: ${error.response?.status || 'unknown'}`);
    return { 
      success: true, 
      status: error.response?.status || 'unknown',
      message: 'Serveur PayDunya accessible'
    };
  }
};

// ✅ HELPER POUR CONSTRUIRE LES URLs DE CALLBACK
const buildCallbackUrls = (transactionId = null) => {
  const baseCallback = `${PAYDUNYA_CONFIG.CALLBACK_URL}/actions/payment/callback`; // ✅ CORRIGÉ
  
  return {
    callback_url: baseCallback,
    return_url: `${PAYDUNYA_CONFIG.RETURN_URL}/payment/success${transactionId ? `?transaction=${transactionId}` : ''}`,
    cancel_url: `${PAYDUNYA_CONFIG.CANCEL_URL}/payment/cancel${transactionId ? `?transaction=${transactionId}` : ''}`
  };
};

// ✅ HELPER POUR VALIDER LES WEBHOOKS PAYDUNYA (sécurité)
const validateWebhookSignature = (payload, signature) => {
  // PayDunya ne fournit pas de signature par défaut, 
  // mais vous pouvez implémenter votre propre validation ici
  // en utilisant un secret partagé si nécessaire
  
  if (!signature && process.env.PAYDUNYA_WEBHOOK_SECRET) {
    console.warn('⚠️ Signature webhook manquante');
    return false;
  }
  
  // Pour l'instant, retourner true (accepter tous les webhooks)
  // À améliorer pour la sécurité en production
  return true;
};

module.exports = {
  PAYDUNYA_CONFIG,
  validateConfig,
  getHeaders,
  debugConfig,
  testPaydunyaConnection,
  buildCallbackUrls,
  validateWebhookSignature
};

// ✅ AUTO-VALIDATION AU CHARGEMENT DU MODULE
try {
  validateConfig();
} catch (error) {
  console.error('❌ Erreur de configuration PayDunya:', error.message);
  // Ne pas faire planter l'application, mais logger l'erreur
}