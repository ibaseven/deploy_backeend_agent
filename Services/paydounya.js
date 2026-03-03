const axios = require('axios');
require('dotenv').config();

// ✅ CORRECTION: Configuration d'URL unifiée et correcte
const PAYDUNYA_CONFIG = {
  BASE_URL: 'https://app.paydunya.com',
  ENDPOINTS: {
    // Endpoints pour les paiements classiques (v1)
    CREATE_INVOICE: '/api/v1/checkout-invoice/create',
    CONFIRM_INVOICE: '/api/v1/checkout-invoice/confirm',
    
    // Endpoints pour les décaissements (v2) - ✅ CORRIGÉ
    CREATE_DISBURSE: '/api/v2/disburse/get-invoice',         // Endpoint correct pour créer
    SUBMIT_DISBURSE: '/api/v2/disburse/submit-invoice',      // Endpoint pour soumettre
    STATUS_DISBURSE: '/api/v2/disburse/status'               // Endpoint pour vérifier statut
  },
  MODE: process.env.NODE_ENV === 'production' ? 'live' : 'test'
};

// Vérifier que les clés existent
/* console.log('🔐 Configuration Paydunya:', {
  baseUrl: PAYDUNYA_CONFIG.BASE_URL,
  mode: PAYDUNYA_CONFIG.MODE,
  masterKey: process.env.PAYDUNYA_MASTER_KEY ? 'définie' : '❌ NON DÉFINIE',
  privateKey: process.env.PAYDUNYA_PRIVATE_KEY ? 'définie' : '❌ NON DÉFINIE',
  publicKey: process.env.PAYDUNYA_PUBLIC_KEY ? 'définie' : '❌ NON DÉFINIE',
  token: process.env.PAYDUNYA_TOKEN ? 'définie' : '❌ NON DÉFINIE'
}); */

const config = {
  masterKey: process.env.PAYDUNYA_MASTER_KEY,
  privateKey: process.env.PAYDUNYA_PRIVATE_KEY,
  publicKey: process.env.PAYDUNYA_PUBLIC_KEY,
  token: process.env.PAYDUNYA_TOKEN,
  mode: PAYDUNYA_CONFIG.MODE
};

const configCI = {
  masterKey: process.env.PAYDUNYA_MASTER_KEY_CI,
  privateKey: process.env.PAYDUNYA_PRIVATE_KEY_CI,
  publicKey: process.env.PAYDUNYA_PUBLIC_KEY_CI,
  token: process.env.PAYDUNYA_TOKEN_CI,
  mode: PAYDUNYA_CONFIG.MODE
};

// ✅ Fonction modifiée pour accepter une config spécifique
const getHeaders = (activeConfig) => ({
  'PAYDUNYA-MASTER-KEY': activeConfig.masterKey,
  'PAYDUNYA-PRIVATE-KEY': activeConfig.privateKey,
  'PAYDUNYA-PUBLIC-KEY': activeConfig.publicKey,
  'PAYDUNYA-TOKEN': activeConfig.token,
  'Content-Type': 'application/json'
});

// Validation des clés requises
if (!config.masterKey || !config.privateKey || !config.publicKey || !config.token) {
  console.error('❌ ERREUR: Clés Paydunya manquantes dans .env');
  //('Vérifiez que ces variables sont définies:');
  //('- PAYDUNYA_MASTER_KEY');
  //('- PAYDUNYA_PRIVATE_KEY'); 
  //('- PAYDUNYA_PUBLIC_KEY');
  //('- PAYDUNYA_TOKEN');
}



const transferToAgentFromPaydunya = async (account_alias, amount, withdraw_mode, userId, callback_url) => {
  try {
    // Vérification que le mode de retrait est valide
    const validWithdrawModes = [
      "paydunya", "orange-money-senegal", "free-money-senegal", "expresso-senegal", "wave-senegal",
      "mtn-benin", "moov-benin", "mtn-ci", "orange-money-ci", "moov-ci", "wave-ci",
      "t-money-togo", "moov-togo", "orange-money-mali", "orange-money-burkina", "moov-burkina-faso"
    ];

    if (!validWithdrawModes.includes(withdraw_mode)) {
      throw new Error(`Méthode de retrait "${withdraw_mode}" non supportée.`);
    }

    // ✅ Déterminer quelle configuration utiliser selon le pays
    const activeConfig = withdraw_mode.includes('-ci') ? configCI : config;
    
    //console.log('🔧 Configuration utilisée:', withdraw_mode.includes('-ci') ? 'Côte d\'Ivoire' : 'Défaut');
    //console.log('🔧 Mode de retrait:', withdraw_mode);

    const payload = {
      amount,
      account_alias,
      withdraw_mode,
      callback_url,
    };

    //console.log('📤 Envoi de requête à Paydunya:', payload);
    
    const fullUrl = `${PAYDUNYA_CONFIG.BASE_URL}${PAYDUNYA_CONFIG.ENDPOINTS.CREATE_DISBURSE}`;
    //console.log('🔗 URL complète:', fullUrl);

    // ✅ Utiliser la configuration sélectionnée
    const response = await axios.post(fullUrl, payload, { 
      headers: getHeaders(activeConfig),
      timeout: 30000
    });

    //console.log('✅ Réponse Paydunya:', response.data);

    if (response.data.response_code === "00" || response.data.status === "success") {
      return {
        success: true,
        transactionId: response.data.transaction_id || response.data.token,
        disburse_token: response.data.disburse_token,
        message: response.data.response_text || response.data.message,
        rawResponse: response.data
      };
    } else {
      throw new Error(response.data.response_text || response.data.message || 'Erreur lors du paiement');
    }
  } catch (error) {
    console.error('❌ Erreur Paydunya:', {
      message: error.message,
      url: error.config?.url,
      responseData: error.response?.data,
      responseStatus: error.response?.status
    });
    
    return {
      success: false,
      error: error.response?.data?.message || error.message || 'Erreur lors du transfert',
      details: error.response?.data
    };
  }
};


const checkPaymentStatus = async (transactionId) => {
  try {
    // ✅ CORRECTION: Utiliser l'endpoint correct pour vérifier les paiement
    const fullUrl = `${PAYDUNYA_CONFIG.BASE_URL}/api/v1/checkout-invoice/confirm/${transactionId}`;
    
    const response = await axios.get(fullUrl, { 
      headers: getHeaders(),
      timeout: 15000
    });

    if (response.data.response_code === "00" || response.data.status === "success") {
      return {
        success: true,
        status: response.data.status,
        data: response.data
      };
    } else {
      throw new Error(response.data.response_text || response.data.message || 'Erreur lors de la vérification');
    }
  } catch (error) {
    console.error('❌ Erreur lors de la vérification du paiement:', error);
    return {
      success: false,
      error: error.response?.data?.message || error.message || 'Erreur lors de la vérification du statut'
    };
  }
};

const submitDisburseInvoice = async (disburse_invoice, disburse_id = null, withdraw_mode = null) => {
  try {
    //console.log('🔍 Soumission de facture de décaissement:', { disburse_invoice, disburse_id, withdraw_mode });
    
    // Validation des paramètres
    if (!disburse_invoice) {
      throw new Error('Le paramètre disburse_invoice est obligatoire');
    }
    
    // ✅ Déterminer quelle configuration utiliser selon le pays
    const activeConfig = withdraw_mode && withdraw_mode.includes('-ci') ? configCI : config;
    
    //console.log('🔧 Configuration utilisée pour soumission:', withdraw_mode && withdraw_mode.includes('-ci') ? 'Côte d\'Ivoire' : 'Défaut');
    //console.log('🔑 Master Key utilisée:', activeConfig.masterKey ? activeConfig.masterKey.substring(0, 10) + '...' : 'UNDEFINED');
    
    // Préparation du payload
    const payload = {
      disburse_invoice: disburse_invoice.trim()
    };
    
    // Ajouter disburse_id au payload uniquement s'il est fourni
    if (disburse_id) {
      payload.disburse_id = disburse_id.trim();
    }
    
    //console.log('📤 Payload soumission:', payload);
    
    const fullUrl = `${PAYDUNYA_CONFIG.BASE_URL}${PAYDUNYA_CONFIG.ENDPOINTS.SUBMIT_DISBURSE}`;
    //console.log('🔗 URL soumission:', fullUrl);
    
    // ✅ Utiliser la configuration sélectionnée
    const response = await axios.post(fullUrl, payload, { 
      headers: getHeaders(activeConfig),
      timeout: 30000
    });
    
    //console.log('✅ Réponse soumission Paydunya:', response.data);
    
    // Analyse de la réponse
    if (response.data.response_code === "00" || 
        response.data.status === "success" || 
        response.data.response_status === "success") {
      return {
        success: true,
        data: response.data,
        message: response.data.response_text || response.data.message || 'Facture soumise avec succès'
      };
    } else {
      console.warn('⚠️ Transaction échouée côté Paydunya:', response.data.description || response.data.response_text);
      return {
        success: false,
        data: response.data,
        error: response.data.response_text || response.data.message || response.data.description || 'Erreur lors de la soumission de la facture'
      };
    }
  } catch (error) {
    console.error('❌ Erreur soumission Paydunya:', {
      message: error.message,
      url: error.config?.url,
      responseData: error.response?.data,
      responseStatus: error.response?.status
    });
    
    return {
      success: false,
      error: error.response?.data?.message || error.response?.data?.description || error.message || 'Erreur lors de la soumission de la facture de décaissement',
      details: error.response?.data
    };
  }
};


const checkDisburseInvoiceStatus = async (disburse_invoice) => {
  try {
    if (!disburse_invoice) {
      throw new Error('Le paramètre disburse_invoice est obligatoire');
    }
    
    // ✅ CORRECTION: Utiliser la configuration centralisée
    const fullUrl = `${PAYDUNYA_CONFIG.BASE_URL}${PAYDUNYA_CONFIG.ENDPOINTS.STATUS_DISBURSE}/${disburse_invoice.trim()}`;
    
    const response = await axios.get(fullUrl, { 
      headers: getHeaders(),
      timeout: 15000
    });
    
    if (response.data.response_code === "00" || 
        response.data.status === "success" || 
        response.data.response_status === "success") {
      return {
        success: true,
        status: response.data.status || response.data.response_status,
        data: response.data
      };
    } else {
      throw new Error(response.data.response_text || response.data.message || 'Erreur lors de la vérification');
    }
  } catch (error) {
    console.error('❌ Erreur lors de la vérification de la facture:', error);
    return {
      success: false,
      error: error.response?.data?.message || error.message || 'Erreur lors de la vérification du statut de la facture'
    };
  }
};

const createDisburseInvoice = async (recipients, callback_url) => {
  try {
    //('🔍 Création de facture de décaissement pour', recipients.length, 'destinataires');
    
    // Validation des paramètres
    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      throw new Error('La liste des destinataires est obligatoire et ne peut pas être vide');
    }
    
    // Vérification des données de chaque destinataire
    for (const recipient of recipients) {
      if (!recipient.account_alias || !recipient.amount || !recipient.withdraw_mode) {
        throw new Error('Chaque destinataire doit avoir account_alias, amount et withdraw_mode');
      }
    }
    
    // Préparation du payload
    const payload = {
      disburse_recipients: recipients,
      callback_url: callback_url || process.env.PAYDUNYA_CALLBACK_URL
    };
    
    //('📤 Payload création:', payload);
    
    // ✅ CORRECTION: Utiliser la configuration centralisée
    const fullUrl = `${PAYDUNYA_CONFIG.BASE_URL}${PAYDUNYA_CONFIG.ENDPOINTS.CREATE_DISBURSE}`;
    //('🔗 URL création:', fullUrl);
    
    // Envoi de la requête
    const response = await axios.post(fullUrl, payload, { 
      headers: getHeaders(),
      timeout: 30000
    });
    
    //('✅ Réponse création Paydunya:', response.data);
    
    // Analyse de la réponse
    if (response.data.response_code === "00" || 
        response.data.status === "success" || 
        response.data.response_status === "success") {
      return {
        success: true,
        disburse_invoice: response.data.disburse_invoice,
        disburse_id: response.data.disburse_id,
        disburse_token: response.data.disburse_token,
        message: response.data.response_text || response.data.message || 'Facture créée avec succès'
      };
    } else {
      throw new Error(response.data.response_text || response.data.message || 'Erreur lors de la création de la facture');
    }
  } catch (error) {
    console.error('❌ Erreur création facture Paydunya:', {
      message: error.message,
      url: error.config?.url,
      responseData: error.response?.data,
      responseStatus: error.response?.status
    });
    
    return {
      success: false,
      error: error.response?.data?.message || error.message || 'Erreur lors de la création de la facture de décaissement',
      details: error.response?.data
    };
  }
};

/**
 * Test de connectivité avec l'API Paydunya
 */
const testPaydunyaConnection = async () => {
  try {
    //('🧪 Test de connexion Paydunya...');
    
    // Test simple avec les headers d'authentification
    const testUrl = `${PAYDUNYA_CONFIG.BASE_URL}/api/v1/test-connection`;
    
    const response = await axios.get(testUrl, {
      headers: {
        'PAYDUNYA-PUBLIC-KEY': config.publicKey
      },
      timeout: 10000,
      validateStatus: (status) => status < 500 // Accepter même les 404, on teste juste la connectivité
    });

    //('✅ Test connexion - Status:', response.status);
    return { 
      success: true, 
      status: response.status,
      message: 'Connexion à Paydunya établie'
    };

  } catch (error) {
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      console.error('❌ Problème de connectivité réseau vers Paydunya');
      return { 
        success: false, 
        error: 'Problème de connectivité réseau',
        details: error.message 
      };
    }
    
    //('🔍 Test connexion - Réponse reçue:', error.response?.status);
    return { 
      success: true, 
      status: error.response?.status || 'unknown',
      message: 'Serveur Paydunya accessible'
    };
  }
};

module.exports = {
  transferToAgentFromPaydunya,
  checkPaymentStatus,
  submitDisburseInvoice,
  checkDisburseInvoiceStatus,
  createDisburseInvoice,
  testPaydunyaConnection,
  PAYDUNYA_CONFIG, // Export pour debug
  config // Export pour debug
};