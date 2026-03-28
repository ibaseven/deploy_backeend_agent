const mongoose = require('mongoose');
const User = require("../Models/User");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const nodemailer = require("nodemailer");
const axios = require("axios");
const qs = require("qs");
const { body, validationResult } = require("express-validator");
const { sendPasswordResetEmail } = require("../Utils/NodeMailerPass");
const secretKey = process.env.JWT_KEY;
const Entreprise = require('../Models/Entreprise');
const { generateAndSaveContract, generateContractPDF } = require('../Services/contractGenerator');
// Configuration UltraMsg
const INSTANCE_ID = process.env.ULTRAMSG_INSTANCE_ID;
const TOKEN = process.env.ULTRAMSG_TOKEN;

// Fonction pour envoyer un message WhatsApp via UltraMsg
async function sendWhatsAppMessage(phoneNumber, message) {
  try {
    const accountId = process.env.LAM_ACCOUNT_ID;
    const password = process.env.LAM_PASSWORD;
    
    if (!accountId || !password) {
      throw new Error('LAM_ACCOUNT_ID et LAM_PASSWORD doivent être configurés dans .env');
    }

    const formattedPhone = formatPhoneNumber(phoneNumber);
    
    const payload = {
      accountid: accountId,
      password: password,
      sender: "Dioko",
      ret_id: `dioko_${Date.now()}`,
      priority: "2",
      text: message,
      to: [
        {
          ret_id_1: formattedPhone
        }
      ]
    };
    
    const response = await axios.post('https://lamsms.lafricamobile.com/api', payload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    return { success: true, response: response.data };
    
  } catch (error) {
    if (error.response) {
      const responseText = error.response.data;
      
      if (responseText.includes('accountid')) {
        throw new Error('Account ID manquant ou invalide');
      } else if (responseText.includes('password')) {
        throw new Error('Mot de passe invalide');
      } else if (responseText.includes('balance') || responseText.includes('credit')) {
        throw new Error('Solde insuffisant sur votre compte LAM');
      } else {
        throw new Error(`Erreur API LAM SMS (${error.response.status}): ${responseText}`);
      }
    }
    throw error;
  }
}
async function sendWhatsAppMessagePass(phoneNumber, message) {
  try {
    const formattedPhone = formatPhoneNumber(phoneNumber);
    
    const data = qs.stringify({
      "token": TOKEN,
      "to": formattedPhone,
      "body": message
    });
    
    const config = {
      method: 'post',
      url: `https://api.ultramsg.com/${INSTANCE_ID}/messages/chat`,
      headers: { 
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      data: data
    };
    
    const response = await axios(config);
    return response.data;
  } catch (error) {
    console.error("Erreur d'envoi WhatsApp:", error);
    throw error;
  }
}
async function uploadFile(filePath) {
  try {
    const fileStream = fs.createReadStream(filePath);
    const formData = new FormData();
    formData.append("file", fileStream);
    formData.append("token", TOKEN);

    const response = await axios.post(
      `https://api.ultramsg.com/${INSTANCE_ID}/media/upload`,
      formData,
      { headers: formData.getHeaders() }
    );

    if (!response.data || !response.data.url) {
      throw new Error("Échec du téléchargement du fichier");
    }

    return response.data.url; // URL publique du fichier
  } catch (error) {
    console.error("Erreur upload fichier UltraMsg:", error.message);
    throw error;
  }
}

async function sendWhatsAppDocument(phone, filePath, caption) {
  try {
    const fileUrl = await uploadFile(filePath);

    const data = qs.stringify({
      token: TOKEN,
      to: phone,
      document: fileUrl,
      filename: "Contrat_Actions.pdf",
      caption: caption
    });

    await axios.post(
      `https://api.ultramsg.com/${INSTANCE_ID}/messages/document`,
      data,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    console.log("✅ Document WhatsApp envoyé !");
    return { success: true };
  } catch (error) {
    console.error("❌ Erreur envoi WhatsApp :", error.message);
    return { success: false };
  }
}
const tempUserStore = {};

// Fonction pour formater le numéro de téléphone (sans indicatif obligatoire)
function formatPhoneNumber(telephone) {
  // Supprimer tous les caractères non numériques
  let cleaned = telephone.replace(/\D/g, '');
  
  // Validation de base - s'assurer que ce n'est pas vide
  if (!cleaned) {
    throw new Error('Numéro de téléphone invalide');
  }
  return cleaned;
}

// Version alternative avec gestion d'erreurs améliorée




// Fonction pour générer un code OTP de 6 chiffres
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Stocker les OTPs générés temporairement (dans une production réelle, utilisez Redis ou une BD)
const otpStore = {};
const passwordResetOtpStore = {};
const createToken = (id, email, role) => {
  return jwt.sign({ data: { id, email, role } }, secretKey, {
    expiresIn: "1d",
  });
};
const calculateDividende = async (nbre_actions) => {
  try {
    // Récupérer l'entreprise la plus récente
    const entreprise = await Entreprise.findOne().sort({ annee: -1 });
    
    if (!entreprise) {
      //('Aucune entreprise trouvée pour le calcul des dividendes');
      return 0;
    }

    // Formule: dividende = benefice * nbre_actions / 100000
    const dividende = (entreprise.total_benefice * nbre_actions) / 100000;
    
    //(`Calcul dividende: ${entreprise.total_benefice} * ${nbre_actions} / 100000 = ${dividende}`);
    
    return dividende;
    
  } catch (error) {
    console.error('Erreur calcul dividende:', error);
    return 0;
  }
}
// Inscription (signUP)
module.exports.signUP = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      success: false,
      message: "Erreurs de validation",
      errors: errors.array() 
    });
  }
  
  try {
    const { firstName, lastName, telephone, email, password, role, nbre_actions } = req.body;

    // Vérifier si l'utilisateur existe déjà
    const userEmailExist = await User.findOne({ email });
    if (userEmailExist) {
      return res.status(409).json({ 
        success: false,
        message: "Un utilisateur avec cet email existe déjà !" 
      });
    }

    // Cryptage du mot de passe
    const salt = await bcrypt.genSalt(10);
    const cryptPassword = await bcrypt.hash(password, salt);

    let userData = {
      firstName,
      lastName,
      telephone,
      email,
      password: cryptPassword,
      role
    };

    // Si c'est un actionnaire, calculer automatiquement les dividendes
    
      
   
    // Création du nouvel utilisateur
    const user = await User.create(userData);

    // Retourner l'utilisateur sans le mot de passe
    const userResponse = user.toObject();
    delete userResponse.password;

    return res.status(201).json({ 
      success: true,
      message: "Utilisateur créé avec succès", 
      user: userResponse 
    });
    
  } catch (error) {
    console.error('Erreur création utilisateur:', error);
    res.status(500).json({ 
      success: false,
      message: "Erreur interne du serveur", 
      error: error.message 
    });
  }
};

/* module.exports.signForNewActionnaire = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      success: false,
      message: "Erreurs de validation",
      errors: errors.array() 
    });
  }
  
  try {
    const { firstName, lastName, telephone, password } = req.body;

    // Vérifier si l'utilisateur existe déjà
    const userTelephoneExist = await User.findOne({ telephone });
    if (userTelephoneExist) {
      return res.status(409).json({ 
        success: false,
        message: "Un utilisateur avec ce numero existe déjà !" 
      });
    }

    // Cryptage du mot de passe
    const salt = await bcrypt.genSalt(10);
    const cryptPassword = await bcrypt.hash(password, salt);

    // Stocker temporairement les données utilisateur
    const tempUserId = new mongoose.Types.ObjectId().toString();
    const tempUserData = {
      firstName,
      lastName,
      telephone,
      password: cryptPassword,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
    };

    // Stocker les données temporaires (vous pouvez utiliser Redis ou une collection temporaire)
    tempUserStore[tempUserId] = tempUserData;

    // Générer et stocker le code OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore[tempUserId] = {
      code: otpCode,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
      type: 'signup'
    };

    // Envoyer le code OTP par WhatsApp
    await sendWhatsAppMessage(telephone, otpCode);

    return res.status(200).json({ 
      success: true,
      message: "Code de vérification envoyé via WhatsApp", 
      tempUserId,
      expiresIn: 5 * 60 // 5 minutes en secondes
    });
    
  } catch (error) {
    console.error('Erreur lors de l\'initiation de création:', error);
    res.status(500).json({ 
      success: false,
      message: "Erreur interne du serveur", 
      error: error.message 
    });
  }
}; */
module.exports.resendSignUpOTP = async (req, res) => {
  const { tempUserId } = req.body;

  try {
    // Vérifier si les données temporaires existent
    if (!tempUserStore[tempUserId]) {
      return res.status(404).json({ 
        success: false,
        message: "Session de création expirée" 
      });
    }

    // Vérifier si les données temporaires n'ont pas expiré
    if (new Date() > tempUserStore[tempUserId].expiresAt) {
      delete tempUserStore[tempUserId];
      if (otpStore[tempUserId]) delete otpStore[tempUserId];
      return res.status(401).json({ 
        success: false,
        message: "Session de création expirée" 
      });
    }

    // Générer un nouveau code OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore[tempUserId] = {
      code: otpCode,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
      type: 'signup'
    };

    // Envoyer le nouveau code OTP
    await sendWhatsAppMessage(tempUserStore[tempUserId].telephone, otpCode);

    return res.status(200).json({ 
      success: true,
      message: "Nouveau code de vérification envoyé", 
      expiresIn: 5 * 60 
    });
    
  } catch (error) {
    console.error('Erreur lors du renvoi OTP:', error);
    res.status(500).json({ 
      success: false,
      message: "Erreur interne du serveur", 
      error: error.message 
    });
  }
};
module.exports.verifyOTPAndCreateAccount = async (req, res) => {
  const { tempUserId, otpCode } = req.body;

  try {
    // Vérifier si le code OTP existe et est valide
    if (!otpStore[tempUserId] || otpStore[tempUserId].code !== otpCode) {
      return res.status(401).json({ 
        success: false,
        message: "Code de vérification invalide" 
      });
    }

    // Vérifier si le code OTP n'a pas expiré
    if (new Date() > otpStore[tempUserId].expiresAt) {
      delete otpStore[tempUserId];
      delete tempUserStore[tempUserId];
      return res.status(401).json({ 
        success: false,
        message: "Code de vérification expiré" 
      });
    }

    // Vérifier si les données temporaires existent
    if (!tempUserStore[tempUserId]) {
      return res.status(404).json({ 
        success: false,
        message: "Données de création expirées" 
      });
    }

    // Vérifier si les données temporaires n'ont pas expiré
    if (new Date() > tempUserStore[tempUserId].expiresAt) {
      delete tempUserStore[tempUserId];
      delete otpStore[tempUserId];
      return res.status(401).json({ 
        success: false,
        message: "Session de création expirée" 
      });
    }

    // Récupérer les données utilisateur temporaires
    const userData = tempUserStore[tempUserId];
    
    // Vérifier une dernière fois si l'utilisateur n'existe pas déjà
    const userTelephoneExist = await User.findOne({ telephone: userData.telephone });
    if (userTelephoneExist) {
      delete tempUserStore[tempUserId];
      delete otpStore[tempUserId];
      return res.status(409).json({ 
        success: false,
        message: "Un utilisateur avec ce numero existe déjà !" 
      });
    }

    // Créer le nouvel utilisateur
    const user = await User.create({
      firstName: userData.firstName,
      lastName: userData.lastName,
      telephone: userData.telephone,
      password: userData.password,
    });

    // Nettoyer les données temporaires
    delete tempUserStore[tempUserId];
    delete otpStore[tempUserId];

    // Générer le token JWT
    const token = createToken(user._id, user.telephone, user.role);

    // Définir le cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 24 * 60 * 60 * 1000,
    });

    // Retourner l'utilisateur sans le mot de passe
    const userResponse = user.toObject();
    delete userResponse.password;

    return res.status(201).json({ 
      success: true,
      message: "Compte créé avec succès", 
      token,
      user: userResponse 
    });
    
  } catch (error) {
    console.error('Erreur lors de la vérification OTP:', error);
    // Nettoyer en cas d'erreur
    if (tempUserStore[tempUserId]) delete tempUserStore[tempUserId];
    if (otpStore[tempUserId]) delete otpStore[tempUserId];
    
    res.status(500).json({ 
      success: false,
      message: "Erreur interne du serveur", 
      error: error.message 
    });
  }
};
module.exports.verifyOTPAndSignIn = async (req, res) => {
  const { userId, otpCode } = req.body;

  try {
    if (!otpStore[userId] || otpStore[userId].code !== otpCode) {
      return res.status(401).json({ message: "Code de vérification invalide" });
    }
    if (new Date() > otpStore[userId].expiresAt) {
      delete otpStore[userId];
      return res.status(401).json({ message: "Code de vérification expiré" });
    }
    const user = await User.findById(userId).select("-password");
    if (!user) {
      return res.status(404).json({ message: "Utilisateur non trouvé" });
    }
    const token = createToken(user._id, user.email, user.role);
    delete otpStore[userId];
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 24 * 60 * 60 * 1000,
    });
    res.status(200).json({ 
      message: "Connexion réussie", 
      token, 
      user 
    });
  } catch (error) {
    console.error("Erreur lors de la vérification OTP:", error);
    res.status(500).json({ message: "Erreur interne du serveur" });
  }
};
// Phase 1 de connexion: Vérifier les identifiants et envoyer un OTP
/* module.exports.initiateSignIn = async (req, res) => {
  const { telephone, password } = req.body;
  //("🔐 Tentative de connexion avec :", { telephone });

  try {
    const user = await User.findOne({ telephone });
    //("🔍 Utilisateur trouvé :", user ? user._id : "Aucun utilisateur trouvé");

    if (!user) {
      console.warn("❌ Échec de connexion : utilisateur non trouvé");
      return res.status(401).json({ message: "telephone ou mot de passe incorrect" });
    }

    if (user.isBlocked) {
      console.warn(`🚫 Compte bloqué pour l'utilisateur : ${user._id}`);
      return res.status(403).json({ message: "Votre compte est bloqué" });
    }

    const comparePassword = await bcrypt.compare(password, user.password);
    //("🔑 Mot de passe correct :", comparePassword);

    if (!comparePassword) {
      console.warn("❌ Échec de connexion : mot de passe incorrect");
      return res.status(401).json({ message: "Email ou mot de passe incorrect" });
    }

    const otp = generateOTP();
    //(`📨 OTP généré pour l'utilisateur ${user._id} : ${otp}`);

    // Stocker l'OTP avec expiration
    otpStore[user._id] = {
      code: otp,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000)
    };
    //(`🗃️ OTP stocké pour l'utilisateur ${user._id} avec expiration à ${otpStore[user._id].expiresAt}`);

    // Envoi du code via WhatsApp
    try {
      //(`📤 Envoi du code OTP par WhatsApp à ${user.telephone}`);
      await sendWhatsAppMessage(
        user.telephone,
        `Votre code de vérification Dioko est: ${otp}. Il expire dans 5 minutes.`
      );

      //("✅ OTP envoyé avec succès");
      res.status(200).json({
        message: "Un code de vérification a été envoyé à votre numéro WhatsApp",
        userId: user._id,
        requireOTP: true
      });

    } catch (msgError) {
      console.error("📛 Erreur lors de l'envoi du message WhatsApp:", msgError);
      res.status(500).json({ message: "Échec de l'envoi du code de vérification" });
    }

  } catch (error) {
    console.error("🔥 Erreur interne lors de l'authentification:", error);
    res.status(500).send({ message: "Erreur interne du serveur" });
  }
}; */
module.exports.signForNewActionnaire = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      success: false,
      message: "Erreurs de validation",
      errors: errors.array() 
    });
  }
  
  try {
    const { firstName, lastName, telephone, password } = req.body;

    // Vérifier si l'utilisateur existe déjà
    const userTelephoneExist = await User.findOne({ telephone });
    if (userTelephoneExist) {
      return res.status(409).json({ 
        success: false,
        message: "Un utilisateur avec ce numero existe déjà !" 
      });
    }

    // Cryptage du mot de passe
    const salt = await bcrypt.genSalt(10);
    const cryptPassword = await bcrypt.hash(password, salt);

    // Créer le nouvel utilisateur directement
    const user = await User.create({
      firstName,
      lastName,
      telephone,
      password: cryptPassword,
    });

    // Générer le token JWT
    const token = createToken(user._id, user.telephone, user.role);

    // Définir le cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 24 * 60 * 60 * 1000, // 24 heures
    });

    // Retourner l'utilisateur sans le mot de passe
    const userResponse = user.toObject();
    delete userResponse.password;

    return res.status(201).json({ 
      success: true,
      message: "Compte créé avec succès", 
      token,
      user: userResponse 
    });
    
  } catch (error) {
    console.error('Erreur lors de la création du compte:', error);
    res.status(500).json({ 
      success: false,
      message: "Erreur interne du serveur", 
      error: error.message 
    });
  }
};
module.exports.sendPasswordResetOTP = async (req, res) => {
  try {
    const { telephone } = req.body;

    // Validation du numéro de téléphone
    if (!telephone) {
      return res.status(400).json({ 
        success: false,
        message: 'Le numéro de téléphone est requis.' 
      });
    }

    // Vérifier si l'utilisateur existe
    const user = await User.findOne({ telephone });

    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'Aucun utilisateur trouvé avec ce numéro de téléphone.' 
      });
    }

    // Vérifier si l'utilisateur n'est pas bloqué
    if (user.isBlocked) {
      return res.status(403).json({ 
        success: false,
        message: 'Votre compte est bloqué. Contactez l\'administrateur.' 
      });
    }

    // Générer un code OTP pour la réinitialisation
    const resetOTP = generateOTP();

    // Stocker l'OTP avec un délai d'expiration (10 minutes)
    passwordResetOtpStore[user._id] = {
      code: resetOTP,
      telephone: telephone,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      attempts: 0 // Compteur de tentatives
    };

    // Message WhatsApp pour la réinitialisation
    const message = `Réinitialisation de mot de passe - Dioko
Bonjour ${user.firstName} ${user.lastName},
Votre code de réinitialisation de mot de passe est : ${resetOTP}
 Ce code expire dans 10 minutes.
 Pour votre sécurité, ne partagez ce code avec personne.
Si vous n'avez pas demandé cette réinitialisation, ignorez ce message.
Équipe Dioko`;

    // Envoyer l'OTP par WhatsApp
    try {
      await sendWhatsAppMessagePass(telephone, message);
      
      //(`OTP de réinitialisation envoyé à ${telephone} pour l'utilisateur ${user._id}`);
      
      return res.status(200).json({ 
        success: true,
        message: 'Un code de réinitialisation a été envoyé à votre numéro WhatsApp.',
        userId: user._id,
        expiresIn: '10 minutes'
      });
      
    } catch (msgError) {
      console.error("Erreur lors de l'envoi du message WhatsApp:", msgError);
      
      // Nettoyer le store en cas d'échec d'envoi
      delete passwordResetOtpStore[user._id];
      
      return res.status(500).json({ 
        success: false,
        message: 'Échec de l\'envoi du code de réinitialisation. Veuillez réessayer.' 
      });
    }

  } catch (error) {
    console.error("Erreur lors de la demande de réinitialisation :", error);
    return res.status(500).json({ 
      success: false,
      message: 'Une erreur est survenue. Veuillez réessayer.' 
    });
  }
};
module.exports.initiateSignIn = async (req, res) => {
  const { telephone, password } = req.body;

  try {
    const user = await User.findOne({ telephone });

    if (!user) {
      console.warn("❌ Échec de connexion : utilisateur non trouvé");
      return res.status(401).json({ message: "Téléphone ou mot de passe incorrect" });
    }

    if (user.isBlocked) {
      console.warn(`🚫 Compte bloqué pour l'utilisateur : ${user._id}`);
      return res.status(403).json({ message: "Votre compte est bloqué" });
    }

    const comparePassword = await bcrypt.compare(password, user.password);

    if (!comparePassword) {
      console.warn("❌ Échec de connexion : mot de passe incorrect");
      return res.status(401).json({ message: "Téléphone ou mot de passe incorrect" });
    }

    // Génération du token directement
    const token = createToken(user._id, user.email, user.role);

    // Récupération des infos utilisateur sans le mot de passe
    const userWithoutPassword = await User.findById(user._id).select("-password");

    // Configuration du cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 24 * 60 * 60 * 1000, // 24 heures
    });

    console.log("✅ Connexion réussie pour l'utilisateur :", user._id);
    
    res.status(200).json({ 
      message: "Connexion réussie", 
      token, 
      user: userWithoutPassword 
    });

  } catch (error) {
    console.error("🔥 Erreur interne lors de l'authentification:", error);
    res.status(500).json({ message: "Erreur interne du serveur" });
  }
};
// Étape 2 : Vérifier l'OTP et permettre la réinitialisation du mot de passe
module.exports.verifyOTPAndResetPassword = async (req, res) => {
  try {
    const { userId, otpCode, newPassword } = req.body;

    // Validation des données
    if (!userId || !otpCode || !newPassword) {
      return res.status(400).json({ 
        success: false,
        message: 'Tous les champs sont requis (userId, otpCode, newPassword).' 
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ 
        success: false,
        message: 'Le nouveau mot de passe doit contenir au moins 6 caractères.' 
      });
    }

    // Vérifier si l'OTP existe pour cet utilisateur
    if (!passwordResetOtpStore[userId]) {
      return res.status(401).json({ 
        success: false,
        message: 'Code de vérification invalide ou expiré.' 
      });
    }

    const otpData = passwordResetOtpStore[userId];

    // Vérifier si l'OTP n'a pas expiré
    if (new Date() > otpData.expiresAt) {
      delete passwordResetOtpStore[userId];
      return res.status(401).json({ 
        success: false,
        message: 'Code de vérification expiré. Veuillez demander un nouveau code.' 
      });
    }

    // Limiter le nombre de tentatives (max 3)
    if (otpData.attempts >= 3) {
      delete passwordResetOtpStore[userId];
      return res.status(429).json({ 
        success: false,
        message: 'Trop de tentatives. Veuillez demander un nouveau code.' 
      });
    }

    // Vérifier si le code OTP est correct
    if (otpData.code !== otpCode) {
      otpData.attempts += 1;
      return res.status(401).json({ 
        success: false,
        message: `Code de vérification incorrect. Tentatives restantes: ${3 - otpData.attempts}` 
      });
    }

    // Rechercher l'utilisateur dans la base de données
    const user = await User.findById(userId);
    if (!user) {
      delete passwordResetOtpStore[userId];
      return res.status(404).json({ 
        success: false,
        message: 'Utilisateur introuvable.' 
      });
    }

    // Vérifier que le téléphone correspond (sécurité supplémentaire)
    if (user.telephone !== otpData.telephone) {
      delete passwordResetOtpStore[userId];
      return res.status(400).json({ 
        success: false,
        message: 'Données de sécurité incorrectes.' 
      });
    }

    // Vérifier que le nouveau mot de passe est différent de l'ancien
    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      return res.status(400).json({ 
        success: false,
        message: 'Le nouveau mot de passe doit être différent de l\'ancien.' 
      });
    }

    // Crypter le nouveau mot de passe
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Mettre à jour le mot de passe
    user.password = hashedPassword;
    await user.save();

    // Nettoyer le store après succès
    delete passwordResetOtpStore[userId];

    // Message de confirmation par WhatsApp
    const confirmationMessage = `✅Mot de passe réinitialisé - Dioko

Bonjour ${user.firstName} ${user.lastName},

Votre mot de passe a été réinitialisé avec succès.

Heure : ${new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Dakar' })}

Si vous n'êtes pas à l'origine de cette action, contactez immédiatement l'administrateur.

Équipe Dioko`;

    // Envoyer la confirmation (optionnel, ne pas bloquer en cas d'erreur)
    try {
      await sendWhatsAppMessage(user.telephone, confirmationMessage);
    } catch (confirmError) {
      console.error("Erreur envoi confirmation:", confirmError);
      // On continue même si l'envoi de confirmation échoue
    }

    //(`Mot de passe réinitialisé avec succès pour l'utilisateur ${userId}`);

    return res.status(200).json({ 
      success: true,
      message: 'Mot de passe réinitialisé avec succès.' 
    });

  } catch (error) {
    console.error('Erreur lors de la réinitialisation du mot de passe :', error);
    return res.status(500).json({ 
      success: false,
      message: 'Une erreur est survenue lors de la réinitialisation.' 
    });
  }
};

// Fonction pour renvoyer un OTP de réinitialisation
module.exports.resendPasswordResetOTP = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ 
        success: false,
        message: 'ID utilisateur requis.' 
      });
    }

    // Vérifier si l'utilisateur existe
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'Utilisateur non trouvé.' 
      });
    }

    // Vérifier si l'utilisateur n'est pas bloqué
    if (user.isBlocked) {
      return res.status(403).json({ 
        success: false,
        message: 'Votre compte est bloqué.' 
      });
    }

    // Générer un nouveau code OTP
    const resetOTP = generateOTP();

    // Stocker le nouveau OTP
    passwordResetOtpStore[user._id] = {
      code: resetOTP,
      telephone: user.telephone,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      attempts: 0
    };

    // Message WhatsApp
    const message = ` Nouveau code de réinitialisation - Dioko
Votre nouveau code de réinitialisation est : ${resetOTP}
Ce code expire dans 10 minutes.
Équipe Dioko`;

    // Envoyer le nouveau OTP
    try {
      await sendWhatsAppMessage(user.telephone, message);
      
      return res.status(200).json({ 
        success: true,
        message: 'Un nouveau code de réinitialisation a été envoyé.',
        userId: user._id
      });
      
    } catch (msgError) {
      console.error("Erreur lors de l'envoi du nouveau code:", msgError);
      delete passwordResetOtpStore[user._id];
      
      return res.status(500).json({ 
        success: false,
        message: 'Échec de l\'envoi du nouveau code.' 
      });
    }

  } catch (error) {
    console.error("Erreur lors du renvoi de l'OTP:", error);
    return res.status(500).json({ 
      success: false,
      message: 'Erreur interne du serveur.' 
    });
  }
};

// Fonction utilitaire pour nettoyer les OTPs expirés (à appeler périodiquement)
module.exports.cleanExpiredPasswordResetOTPs = () => {
  const now = new Date();
  for (const userId in passwordResetOtpStore) {
    if (passwordResetOtpStore[userId].expiresAt < now) {
      delete passwordResetOtpStore[userId];
    }
  }
};

// Nettoyer les OTPs expirés toutes les 15 minutes
setInterval(() => {
  module.exports.cleanExpiredPasswordResetOTPs();
}, 15 * 60 * 1000);
module.exports.getAllUsers = async (req, res) => {
  try {
      const users = await User.find().select("-password");
      res.status(200).json(users);
  } catch (error) {
      res.status(500).json({ message: "Erreur lors de la récupération des utilisateurs" });
  }
};

module.exports.blockUser = async (req, res) => {
  const { userId } = req.body;
  try {
    const user = await User.findByIdAndUpdate(
      userId,
      { isBlocked: true, status: "blocked" },
      { new: true }
    );
    if (!user) {
      return res.status(404).json({ message: "Utilisateur non trouvé" });
    }
    res.status(200).json({ message: "Utilisateur bloqué avec succès", user });
  } catch (error) {
    console.error("Erreur lors du blocage :", error);
    res.status(500).json({ message: "Erreur lors du blocage de l'utilisateur" });
  }
};

module.exports.unblockUser = async (req, res) => {
  const { userId } = req.body;
  try {
    const user = await User.findByIdAndUpdate(
      userId,
      { isBlocked: false, status: "active" },
      { new: true }
    );
    if (!user) {
      return res.status(404).json({ message: "Utilisateur non trouvé" });
    }
    res.status(200).json({ message: "Utilisateur débloqué avec succès", user });
  } catch (error) {
    console.error("Erreur lors du déblocage :", error);
    res.status(500).json({ message: "Erreur lors du déblocage de l'utilisateur" });
  }
};

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL,
    pass: process.env.PASSWORD,
  },
});
module.exports.resetPassWord = async (req, res) => {
  try {
    const resetToken = req.params.resetToken;
    const { password } = req.body;

    // Vérifier si le token est valide
    jwt.verify(resetToken, secretKey, async (err, decoded) => {
      if (err) {
        return res.status(400).json({ message: 'Token de réinitialisation invalide ou expiré.' });
      }

      const userId = decoded.id;

      // Rechercher l'utilisateur dans la base de données
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ message: 'Utilisateur introuvable.' });
      }

      // Crypter le nouveau mot de passe
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      // Mettre à jour le mot de passe
      user.password = hashedPassword;
      await user.save();

      return res.status(200).json({ message: 'Mot de passe réinitialisé avec succès.' });
    });
  } catch (error) {
    console.error('Erreur lors de la réinitialisation du mot de passe :', error);
    return res.status(500).json({ message: 'Une erreur est survenue lors de la réinitialisation.' });
  }
};
module.exports.createAccount = async (req, res) => {
  const { telephone, firstName, lastName, nbre_actions } = req.body;
  const password = generateRandomPassword();

  try {
    // Hash du mot de passe
    const hashedPassword = await bcrypt.hash(password, 10);

    // Si le numéro est vide => renvoyer erreur
    if (!telephone) {
      return res.status(400).json({
        success: false,
        message: "Le numéro de téléphone est requis."
      });
    }

    // Vérifier qu'une entreprise existe pour calculer les dividendes
    const entreprise = await Entreprise.findOne().sort({ annee: -1 });
    if (!entreprise) {
      return res.status(400).json({
        success: false,
        message: "Aucune entreprise trouvée. Veuillez d'abord créer une entreprise pour calculer les dividendes."
      });
    }

    // Calculer automatiquement les dividendes
    const actionsCount = nbre_actions || 0;
    let dividendeCalcule = await calculateDividende(actionsCount);
    
    // Bonus pour les gros actionnaires (plus de 1000 actions)
    let bonusApplique = false;
    if (actionsCount < 1000) {
      dividendeCalcule += 10000; // Ajouter 10 000 FCFA de bonus
      bonusApplique = true;
      //(`💰 Bonus de 10 000 FCFA appliqué pour ${firstName} ${lastName} (${actionsCount} actions)`);
    }

    // Construire le message WhatsApp avec les informations de dividendes
    const bonusText = bonusApplique ? ' Bonus gros porteur: +10 000 FCFA' : '';
    
    const message = ` Bonjour ${firstName} ${lastName},
Votre compte Dioko a été créé avec succès.
 Téléphone: ${telephone}
 Mot de passe temporaire: ${password}
 Actions: ${actionsCount}
 Veuillez vous connecter sur https://actionnaire.diokoclient.com/
et changer votre mot de passe.
Merci d'etre partenaire de Dioko !`;

    // Envoi du message WhatsApp
    await sendWhatsAppMessage(telephone, message);

    // Enregistrement de l'utilisateur avec dividendes calculés
    const user = new User({
      telephone,
      firstName,
      lastName,
      password: hashedPassword,
      role: "actionnaire",
      nbre_actions: actionsCount,
      dividende: dividendeCalcule
    });

    await user.save();

    // Créer le token
    const token = createToken(user._id);

    // Préparer la réponse sans le mot de passe
    const userResponse = user.toObject();
    delete userResponse.password;

    res.status(200).json({
      success: true,
      message: "Compte créé avec succès! Les informations de connexion ont été envoyées par WhatsApp.",
      user: userResponse,
      dividendeInfo: {
        entreprise_annee: entreprise.annee,
        benefice_utilise: entreprise.total_benefice,
        formule_appliquee: `${entreprise.total_benefice} * ${actionsCount} / 100000 = ${(dividendeCalcule - (bonusApplique ? 10000 : 0)).toFixed(2)}`,
        bonus_gros_porteur: bonusApplique ? 10000 : 0,
        dividende_calcule: dividendeCalcule.toFixed(2)
      },
      token
    });

  } catch (error) {
    console.error("Erreur lors de la création du compte:", error);

    // Gestion d'erreurs spécifiques
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Un utilisateur avec ce téléphone existe déjà."
      });
    }

    res.status(500).json({
      success: false,
      message: "Erreur lors de la création du compte",
      error: error.message
    });
  }
};



// Fonction pour générer un mot de passe aléatoire
function generateRandomPassword(length = 8) {
  const characters = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let password = "";
  for (let i = 0; i < length; i++) {
    password += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return password;
}

module.exports.changePassword = async (req, res) => {
  const { email, currentPassword, newPassword } = req.body;

  try {
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: "Utilisateur non trouvé" });
    }

    // Vérifiez si le mot de passe actuel est correct
    const isPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password
    );

    if (!isPasswordValid) {
      return res.status(401).json({ message: "Mot de passe actuel incorrect" });
    }

    // Hash le nouveau mot de passe
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    // Mettez à jour le mot de passe dans la base de données
    user.password = hashedNewPassword;
    await user.save();

    res.status(200).json({ message: "Mot de passe mis à jour avec succès" });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ message: "Erreur lors de la mise à jour du mot de passe" });
  }
};

module.exports.checkAndGetUserByToken = async (req, res) => {
  try {
      const { token } = req.params;
      let userData;

      if (!token) {
          return res.status(403).send({ message: "Accès refusé, token manquant" });
      }

      jwt.verify(token, secretKey, (err, decoded) => {
          if (err) {
              return res.status(403).send({ message: "Token invalide" });
          }

          userData = decoded.data;
      });

      // Vérifier si userData est bien défini
      if (!userData) {
          return res.status(403).send({ message: "Erreur lors de la vérification du token" });
      }

      // Recherchez l'utilisateur par ID en ne récupérant que certains champs
      const user = await User.findById(userData.id).select("firstName lastName email role");

      if (!user) {
          return res.status(404).json({ message: "Utilisateur non trouvé" });
      }

      return res.status(200).json({ message: "Utilisateur récupéré avec succès", user });
  } catch (error) {
      return res.status(500).json({ message: "Erreur serveur", error: error.message });
  }
};

module.exports.getMyActions = async (req, res) => {
  try {
    // Récupérer l'ID utilisateur depuis le token (middleware d'authentification requis)
    const userId = req.user?.id || req.userData?.id;

    if (!userId) {
      return res.status(401).json({ 
        success: false,
        message: "Utilisateur non authentifié" 
      });
    }

    // Rechercher l'utilisateur par ID
    const user = await User.findById(userId).select("firstName lastName email telephone role nbre_actions dividende telephonePartenaire");

    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: "Utilisateur non trouvé" 
      });
    }

    // Vérifier si l'utilisateur est un actionnaire
    if (user.role !== 'actionnaire') {
      return res.status(200).json({ 
        success: true,
        message: "Vous n'êtes pas un actionnaire",
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          telephone: user.telephone,
          role: user.role
        },
        actions: null
      });
    }

   

   

    // Préparer la réponse
    const actionInfo = {
      nbre_actions: user.nbre_actions || 0,
      dividende_actuel:  user.dividende  ,
      derniere_mise_a_jour: user.updatedAt
    };

   

    res.status(200).json({ 
      success: true,
      message: "Vos informations d'actions récupérées avec succès",
      actions: actionInfo
    });

  } catch (error) {
    console.error('Erreur lors de la récupération de mes actions:', error);
    res.status(500).json({ 
      success: false,
      message: "Erreur interne du serveur", 
      error: error.message 
    });
  }
};

// Fonction pour mettre à jour un utilisateur (réservée aux admins)
module.exports.updateUser = async (req, res) => {
  try {
    // Vérifier si l'utilisateur connecté est un admin
    const adminId = req.user?.id || req.userData?.id;
    const adminUser = await User.findById(adminId);
    
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({ 
        success: false,
        message: "Accès refusé. Seuls les administrateurs peuvent mettre à jour les utilisateurs." 
      });
    }

    const { userId } = req.params;
    const { firstName, lastName, dividende, role, nbre_actions, isBlocked } = req.body;

    // Empêcher un admin de se dégrader lui-même
    if (role && role !== 'admin' && userId === adminId) {
      return res.status(400).json({ 
        success: false,
        message: "Un administrateur ne peut pas modifier son propre rôle." 
      });
    }

    // Empêcher un admin de se bloquer lui-même
    if (isBlocked === true && userId === adminId) {
      return res.status(400).json({ 
        success: false,
        message: "Un administrateur ne peut pas se bloquer lui-même." 
      });
    }

    // Vérifier si l'utilisateur existe
    const existingUser = await User.findById(userId);
    if (!existingUser) {
      return res.status(404).json({ 
        success: false,
        message: "Utilisateur non trouvé" 
      });
    }

    // Préparer les données à mettre à jour
    let updateData = {};
    
    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (role !== undefined) updateData.role = role;
    if (isBlocked !== undefined) updateData.isBlocked = isBlocked;

    // Gérer les actions et dividendes pour les actionnaires
   
      
        updateData.nbre_actions = nbre_actions;
        updateData.dividende=dividende
  
      // PRIORITÉ 2: Si
      
    // Si le rôle change vers admin, nettoyer les champs actionnaire
    if (role === 'admin' && existingUser.role === 'actionnaire') {
      updateData.nbre_actions = undefined;
      updateData.dividende = undefined;
    }

    // Mettre à jour l'utilisateur
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true }
    ).select('-password');

    return res.status(200).json({
      success: true,
      message: "Utilisateur mis à jour avec succès",
      user: updatedUser
    });
    
  } catch (error) {
    console.error('Erreur mise à jour utilisateur:', error);
    res.status(500).json({ 
      success: false,
      message: "Erreur interne du serveur", 
      error: error.message 
    });
  }
};

// Fonction utilitaire pour calculer les dividendes selon une année spécifique
const calculateDividendesForYear = (nbre_actions, benefice_annee) => {
  return (benefice_annee * nbre_actions) / 100000;
};

// Fonction utilitaire pour calculer les dividendes cumulés jusqu'à une année donnée
const calculateCumulativeDividendes = async (nbre_actions, annee_limite = null) => {
  let query = {};
  if (annee_limite) {
    query.annee = { $lte: annee_limite };
  }
  
  const entreprises = await Entreprise.find(query);
  return entreprises.reduce((total, ent) => {
    return total + calculateDividendesForYear(nbre_actions, ent.total_benefice);
  }, 0);
};

// Récupérer tous les actionnaires avec sélection d'année (pour l'admin)
module.exports.getAllActionnaires = async (req, res) => {
  try {
    // Vérifier si l'utilisateur connecté est un admin
    const adminId = req.user?.id || req.userData?.id;
    const adminUser = await User.findById(adminId);
    
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({ 
        success: false,
        message: "Accès refusé. Seuls les administrateurs peuvent voir cette information." 
      });
    }

    // Récupérer l'année sélectionnée depuis la query string
    const { annee } = req.query;
    const anneeSelectionnee = annee ? parseInt(annee) : null;

    // Récupérer tous les actionnaires avec leurs informations complètes
    const actionnaires = await User.find({ role: 'actionnaire' })
      .select('firstName lastName email telephone nbre_actions dividende isBlocked status createdAt updatedAt')
      .sort({ lastName: 1, firstName: 1 });

    // Récupérer toutes les entreprises (années) triées par année décroissante
    const toutesEntreprises = await Entreprise.find().sort({ annee: -1 });

    // Calculer la somme totale des bénéfices de toutes les années
    const totalBeneficesGlobal = toutesEntreprises.reduce((sum, ent) => sum + (ent.total_benefice || 0), 0);

    // Déterminer l'entreprise à afficher
    let entrepriseSelectionnee;
    let modeAffichage = 'global'; // 'global' ou 'annee_specifique'

    if (anneeSelectionnee) {
      // Si une année spécifique est demandée
      entrepriseSelectionnee = toutesEntreprises.find(ent => ent.annee === anneeSelectionnee);
      if (!entrepriseSelectionnee) {
        return res.status(404).json({
          success: false,
          message: `Aucune entreprise trouvée pour l'année ${anneeSelectionnee}`
        });
      }
      modeAffichage = 'annee_specifique';
    } else {
      // Par défaut, prendre l'année la plus récente pour l'affichage
      entrepriseSelectionnee = toutesEntreprises[0];
      modeAffichage = 'global';
    }

    // Calculer les dividendes pour chaque actionnaire selon le mode d'affichage
    const actionnairesMisAJour = await Promise.all(
      actionnaires.map(async (user) => {
        let dividendeCalcule;
        
        if (modeAffichage === 'annee_specifique') {
          // Calculer seulement les dividendes pour l'année spécifique
          dividendeCalcule = calculateDividendesForYear(
            user.nbre_actions || 0, 
            entrepriseSelectionnee.total_benefice
          );
        } else {
          // Mode global : utiliser les dividendes cumulés actuels (stockés en base)
          dividendeCalcule = user.dividende || 0;
        }

        return {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          telephone: user.telephone,
          nbre_actions: user.nbre_actions || 0,
          dividende_actuel: dividendeCalcule,
          isBlocked: user.isBlocked,
          status: user.status,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        };
      })
    );

    // Calculer les statistiques selon le mode d'affichage
    const totalActions = actionnairesMisAJour.reduce((sum, user) => sum + user.nbre_actions, 0);
    const totalDividendes = actionnairesMisAJour.reduce((sum, user) => sum + user.dividende_actuel, 0);
    const actionnairesActifs = actionnairesMisAJour.filter(user => !user.isBlocked).length;
    const actionnairesBloques = actionnairesMisAJour.filter(user => user.isBlocked).length;

    res.status(200).json({
      success: true,
      message: `Liste des actionnaires récupérée avec succès${modeAffichage === 'annee_specifique' ? ` pour l'année ${anneeSelectionnee}` : ''}`,
      mode_affichage: modeAffichage,
      annee_selectionnee: anneeSelectionnee,
      actionnaires: actionnairesMisAJour,
      statistiques: {
        nombre_total_actionnaires: actionnairesMisAJour.length,
        actionnaires_actifs: actionnairesActifs,
        actionnaires_bloques: actionnairesBloques,
        total_actions: totalActions,
        total_dividendes: parseFloat(totalDividendes.toFixed(2))
      },
      entreprise_info: entrepriseSelectionnee ? {
        annee: entrepriseSelectionnee.annee,
        benefice: entrepriseSelectionnee.total_benefice,
        formule: modeAffichage === 'annee_specifique' 
          ? `dividende = ${entrepriseSelectionnee.total_benefice} * nbre_actions / 100000 (pour l'année ${entrepriseSelectionnee.annee} uniquement)`
          : "dividende = benefice * nbre_actions / 100000 (cumulé toutes années)",
        rapport: entrepriseSelectionnee.rapport,
        mode_calcul: modeAffichage === 'annee_specifique' ? 'annee_unique' : 'cumule'
      } : null,
      // Données pour la gestion des années
      toutes_annees: toutesEntreprises.map(ent => ({
        annee: ent.annee,
        benefice: ent.total_benefice,
        rapport: ent.rapport,
        createdAt: ent.createdAt
      })),
      resume_global: {
        nombre_annees: toutesEntreprises.length,
        total_benefices_toutes_annees: parseFloat(totalBeneficesGlobal.toFixed(2)),
        premiere_annee: toutesEntreprises.length > 0 ? Math.min(...toutesEntreprises.map(e => e.annee)) : null,
        derniere_annee: toutesEntreprises.length > 0 ? Math.max(...toutesEntreprises.map(e => e.annee)) : null,
        moyenne_benefice_par_annee: toutesEntreprises.length > 0 
          ? parseFloat((totalBeneficesGlobal / toutesEntreprises.length).toFixed(2)) 
          : 0
      }
    });

  } catch (error) {
    console.error('Erreur récupération actionnaires:', error);
    res.status(500).json({ 
      success: false,
      message: "Erreur interne du serveur", 
      error: error.message 
    });
  }
};

// Récupérer uniquement les informations des entreprises (années)
module.exports.getAllEntreprises = async (req, res) => {
  try {
    // Vérifier si l'utilisateur connecté est un admin
    const adminId = req.user?.id || req.userData?.id;
    const adminUser = await User.findById(adminId);
    
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({ 
        success: false,
        message: "Accès refusé. Seuls les administrateurs peuvent voir cette information." 
      });
    }

    // Récupérer toutes les entreprises
    const entreprises = await Entreprise.find().sort({ annee: -1 });

    // Calculer les statistiques
    const totalBenefices = entreprises.reduce((sum, ent) => sum + (ent.total_benefice || 0), 0);

    res.status(200).json({
      success: true,
      message: "Liste des entreprises récupérée avec succès",
      entreprises: entreprises.map(ent => ({
        id: ent._id,
        annee: ent.annee,
        total_benefice: ent.total_benefice,
        rapport: ent.rapport,
        createdAt: ent.createdAt,
        updatedAt: ent.updatedAt
      })),
      statistiques: {
        nombre_annees: entreprises.length,
        total_benefices: parseFloat(totalBenefices.toFixed(2)),
        moyenne_benefice: entreprises.length > 0 
          ? parseFloat((totalBenefices / entreprises.length).toFixed(2)) 
          : 0,
        premiere_annee: entreprises.length > 0 ? Math.min(...entreprises.map(e => e.annee)) : null,
        derniere_annee: entreprises.length > 0 ? Math.max(...entreprises.map(e => e.annee)) : null
      }
    });

  } catch (error) {
    console.error('Erreur récupération entreprises:', error);
    res.status(500).json({ 
      success: false,
      message: "Erreur interne du serveur", 
      error: error.message 
    });
  }
};

  module.exports.getMyActions = async (req, res) => {
  try {
    // Récupérer l'ID utilisateur depuis le token
    const userId = req.user?.id || req.userData?.id;

    if (!userId) {
      return res.status(401).json({ 
        success: false,
        message: "Utilisateur non authentifié" 
      });
    }

    // Rechercher l'utilisateur par ID
    const user = await User.findById(userId).select("firstName lastName email telephone role nbre_actions dividende isBlocked status telephonePartenaire");

    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: "Utilisateur non trouvé" 
      });
    }

    // Vérifier si l'utilisateur est bloqué
    if (user.isBlocked) {
      return res.status(403).json({ 
        success: false,
        message: "Votre compte est bloqué. Contactez l'administrateur." 
      });
    }

    // Vérifier si l'utilisateur est un actionnaire
    if (user.role !== 'actionnaire') {
      return res.status(200).json({ 
        success: true,
        message: "Vous n'êtes pas un actionnaire",
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          telephone: user.telephone,
          role: user.role
        },
        actions: null
      });
    }

    // Récupérer l'entreprise pour contexte
    const entreprise = await Entreprise.findOne().sort({ annee: -1 });

    // Préparer la réponse
    const actionInfo = {
      nbre_actions: user.nbre_actions || 0,
      dividende_actuel: user.dividende || 0,
      derniere_mise_a_jour: user.updatedAt
    };

    res.status(200).json({ 
      success: true,
      message: "Vos informations d'actions récupérées avec succès",
      actions: actionInfo,
      user_info: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        telephone: user.telephone,
        telephonePartenaire: user.telephonePartenaire,
      },
      entreprise_info: entreprise ? {
        annee: entreprise.annee,
        benefice: entreprise.total_benefice,
        formule: "dividende = benefice * nbre_actions / 100000"
      } : null
    });

  } catch (error) {
    console.error('Erreur lors de la récupération de mes actions:', error);
    res.status(500).json({ 
      success: false,
      message: "Erreur interne du serveur", 
      error: error.message 
    });
  }
};

// Bloquer/Débloquer un actionnaire (pour l'admin)
module.exports.toggleActionnaireStatus = async (req, res) => {
  try {
    // Vérifier si l'utilisateur connecté est un admin
    const adminId = req.user?.id || req.userData?.id;
    const adminUser = await User.findById(adminId);
    
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({ 
        success: false,
        message: "Accès refusé. Seuls les administrateurs peuvent modifier le statut des actionnaires." 
      });
    }

    const { actionnaireId, isBlocked } = req.body;

    // Validation des données
    if (!actionnaireId) {
      return res.status(400).json({ 
        success: false,
        message: "ID de l'actionnaire requis" 
      });
    }

    if (typeof isBlocked !== 'boolean') {
      return res.status(400).json({ 
        success: false,
        message: "Le statut de blocage doit être true ou false" 
      });
    }

    // Empêcher un admin de se bloquer lui-même
    if (actionnaireId === adminId) {
      return res.status(400).json({ 
        success: false,
        message: "Un administrateur ne peut pas modifier son propre statut." 
      });
    }

    // Vérifier si l'actionnaire existe et a le bon rôle
    const actionnaire = await User.findById(actionnaireId);
    if (!actionnaire) {
      return res.status(404).json({ 
        success: false,
        message: "Actionnaire non trouvé" 
      });
    }

    if (actionnaire.role !== 'actionnaire') {
      return res.status(400).json({ 
        success: false,
        message: "Cet utilisateur n'est pas un actionnaire" 
      });
    }

    // Mettre à jour le statut
    const updatedUser = await User.findByIdAndUpdate(
      actionnaireId,
      { 
        isBlocked: isBlocked,
        status: isBlocked ? "blocked" : "active"
      },
      { new: true }
    ).select('-password');

    const action = isBlocked ? "bloqué" : "débloqué";
    
    res.status(200).json({ 
      success: true,
      message: `Actionnaire ${action} avec succès`,
      actionnaire: {
        id: updatedUser._id,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        email: updatedUser.email,
        telephone: updatedUser.telephone,
        nbre_actions: updatedUser.nbre_actions,
        dividende_actuel: updatedUser.dividende,
        isBlocked: updatedUser.isBlocked,
        status: updatedUser.status
      }
    });

  } catch (error) {
    console.error("Erreur lors du changement de statut:", error);
    res.status(500).json({ 
      success: false,
      message: "Erreur lors du changement de statut de l'actionnaire",
      error: error.message 
    });
  }
};

// Controller pour les actionnaires - Accès aux bénéfices de l'entreprise uniquement
module.exports.getBeneficesEntreprise = async (req, res) => {
  try {
    // Vérifier si l'utilisateur connecté est un actionnaire
    const userId = req.user?.id || req.userData?.id;
    const user = await User.findById(userId);
    
    if (!user || user.role !== 'actionnaire') {
      return res.status(403).json({ 
        success: false,
        message: "Accès refusé. Seuls les actionnaires peuvent voir cette information." 
      });
    }

    // Récupérer l'année sélectionnée depuis la query string (optionnel)
    const { annee } = req.query;
    const anneeSelectionnee = annee ? parseInt(annee) : null;

    // Récupérer toutes les entreprises (années) triées par année décroissante
    const toutesEntreprises = await Entreprise.find().sort({ annee: -1 });

    if (toutesEntreprises.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Aucune information d'entreprise disponible"
      });
    }

    // Calculer la somme totale des bénéfices de toutes les années
    const totalBeneficesGlobal = toutesEntreprises.reduce((sum, ent) => sum + (ent.total_benefice || 0), 0);

    // Déterminer l'entreprise à afficher
    let entrepriseSelectionnee;
    let modeAffichage = 'global'; // 'global' ou 'annee_specifique'

    if (anneeSelectionnee) {
      // Si une année spécifique est demandée
      entrepriseSelectionnee = toutesEntreprises.find(ent => ent.annee === anneeSelectionnee);
      if (!entrepriseSelectionnee) {
        return res.status(404).json({
          success: false,
          message: `Aucune entreprise trouvée pour l'année ${anneeSelectionnee}`
        });
      }
      modeAffichage = 'annee_specifique';
    } else {
      // Par défaut, prendre l'année la plus récente pour l'affichage
      entrepriseSelectionnee = toutesEntreprises[0];
      modeAffichage = 'global';
    }

    res.status(200).json({
      success: true,
      message: `Informations des bénéfices récupérées avec succès${modeAffichage === 'annee_specifique' ? ` pour l'année ${anneeSelectionnee}` : ''}`,
      mode_affichage: modeAffichage,
      annee_selectionnee: anneeSelectionnee,
      entreprise_info: {
        annee: entrepriseSelectionnee.annee,
        benefice: entrepriseSelectionnee.total_benefice,
        formule: modeAffichage === 'annee_specifique' 
          ? `dividende = ${entrepriseSelectionnee.total_benefice} * nbre_actions / 100000 (pour l'année ${entrepriseSelectionnee.annee} uniquement)`
          : "dividende = benefice * nbre_actions / 100000 (cumulé toutes années)",
        rapport: entrepriseSelectionnee.rapport,
        mode_calcul: modeAffichage === 'annee_specifique' ? 'annee_unique' : 'cumule'
      },
      // Liste de toutes les années disponibles pour la navigation
      toutes_annees: toutesEntreprises.map(ent => ({
        annee: ent.annee,
        benefice: ent.total_benefice,
        rapport: ent.rapport ? true : false, // Juste indiquer s'il y a un rapport, sans le contenu
        createdAt: ent.createdAt
      })),
      resume_global: {
        nombre_annees: toutesEntreprises.length,
        total_benefices_toutes_annees: parseFloat(totalBeneficesGlobal.toFixed(2)),
        premiere_annee: toutesEntreprises.length > 0 ? Math.min(...toutesEntreprises.map(e => e.annee)) : null,
        derniere_annee: toutesEntreprises.length > 0 ? Math.max(...toutesEntreprises.map(e => e.annee)) : null,
        moyenne_benefice_par_annee: toutesEntreprises.length > 0 
          ? parseFloat((totalBeneficesGlobal / toutesEntreprises.length).toFixed(2)) 
          : 0
      }
    });

  } catch (error) {
    console.error('Erreur récupération bénéfices entreprise:', error);
    res.status(500).json({ 
      success: false,
      message: "Erreur interne du serveur", 
      error: error.message 
    });
  }
};

// Controller pour récupérer les informations personnelles de l'actionnaire
module.exports.getMyActionnaireInfo = async (req, res) => {
  try {
    // Vérifier si l'utilisateur connecté est un actionnaire
    const userId = req.user?.id || req.userData?.id;
    const user = await User.findById(userId);
    
    if (!user || user.role !== 'actionnaire') {
      return res.status(403).json({ 
        success: false,
        message: "Accès refusé. Seuls les actionnaires peuvent voir cette information." 
      });
    }

    // Récupérer les informations de l'actionnaire connecté
    const actionnaireInfo = {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      telephone: user.telephone,
      nbre_actions: user.nbre_actions || 0,
      dividende_actuel: user.dividende || 0,
      derniere_mise_a_jour: user.updatedAt,
      status: user.status,
      isBlocked: user.isBlocked
    };

    // Calculer la valeur par action
    const valuePerAction = actionnaireInfo.nbre_actions > 0 
      ? actionnaireInfo.dividende_actuel / actionnaireInfo.nbre_actions 
      : 0;

    res.status(200).json({
      success: true,
      message: "Informations de l'actionnaire récupérées avec succès",
      actions: {
        nbre_actions: actionnaireInfo.nbre_actions,
        dividende_actuel: actionnaireInfo.dividende_actuel,
        derniere_mise_a_jour: actionnaireInfo.derniere_mise_a_jour
      },
      user_info: {
        id: actionnaireInfo.id,
        firstName: actionnaireInfo.firstName,
        lastName: actionnaireInfo.lastName,
        email: actionnaireInfo.email,
        telephone: actionnaireInfo.telephone
      },
      statistiques_personnelles: {
        valeur_par_action: parseFloat(valuePerAction.toFixed(2)),
        statut_compte: actionnaireInfo.isBlocked ? 'bloqué' : 'actif',
        status: actionnaireInfo.status
      }
    });

  } catch (error) {
    console.error('Erreur récupération informations actionnaire:', error);
    res.status(500).json({ 
      success: false,
      message: "Erreur interne du serveur", 
      error: error.message 
    });
  }
};
module.exports.getMyParrainageInfo = async (req, res) => {
  try {
    const userId = req.user?.id || req.userData?.id;
    const user = await User.findById(userId).select('firstName lastName telephone telephonePartenaire');

    if (!user) {
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    }

    // Trouver le parrain (la personne qui a parrainé cet utilisateur)
    let parrain = null;
    if (user.telephonePartenaire) {
      const parrainUser = await User.findOne({ telephone: user.telephonePartenaire })
        .select('firstName lastName telephone');
      if (parrainUser) {
        parrain = {
          nom: `${parrainUser.firstName} ${parrainUser.lastName}`,
          telephone: parrainUser.telephone
        };
      }
    }

    // Trouver les filleuls (personnes que cet utilisateur a parrainées)
    const filleuls = await User.find({ telephonePartenaire: user.telephone })
      .select('firstName lastName telephone')
      .lean();

    return res.status(200).json({
      success: true,
      parrain,
      filleuls: filleuls.map(f => ({
        nom: `${f.firstName} ${f.lastName}`,
        telephone: f.telephone
      })),
      nombre_filleuls: filleuls.length
    });

  } catch (error) {
    console.error('Erreur getMyParrainageInfo:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  }
};

module.exports.getUserById = async (req, res) => {
    try {
        const { id } = req.params; // ID de l'utilisateur passé en paramètre de route

        // Recherchez l'utilisateur par ID en ne récupérant que certains champs
        const user = await User.findById(id);

        if (!user) {
            return res.status(404).json({ message: 'Utilisateur non trouvé' });
        }

       

        return res.status(200).json({ message: 'Utilisateur récupéré avec succès', user });
    } catch (error) {
        res.status(500).json({ message: 'Erreur lors de la récupération de l\'utilisateur', error: error.message });
    }
};

module.exports.getOtherUsers = async (req, res) => {
    try {
        // Fetch only users with role "Organizer" or "Media", excluding archived accounts
        const users = await User.find({
            role: { $in: ["actionnaire", "admin"] },
            "userVerified.userArchived": { $ne: true } // Exclude archived users
        });

        return res.status(200).json({
            message: 'Utilisateurs récupérés avec succès',
            users
        });
    } catch (error) {
        console.error("Erreur lors de la récupération des utilisateurs :", error);
        return res.status(500).json({
            message: 'Erreur lors de la récupération des utilisateurs'
        });
    }
};

module.exports.changePassword = async (req, res) => {
  try {
    const { userId, currentPassword, newPassword } = req.body;

    // Validation des données
    if (!userId || !currentPassword || !newPassword) {
      return res.status(400).json({ 
        message: 'Tous les champs sont requis.' 
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ 
        message: 'Le nouveau mot de passe doit contenir au moins 6 caractères.' 
      });
    }

    // Rechercher l'utilisateur dans la base de données
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ 
        message: 'Utilisateur introuvable.' 
      });
    }

    // Vérifier le mot de passe actuel
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({ 
        message: 'Le mot de passe actuel est incorrect.' 
      });
    }

    // Vérifier que le nouveau mot de passe est différent de l'ancien
    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      return res.status(400).json({ 
        message: 'Le nouveau mot de passe doit être différent de l\'ancien.' 
      });
    }

    // Crypter le nouveau mot de passe
    const salt = await bcrypt.genSalt(10);
    const hashedNewPassword = await bcrypt.hash(newPassword, salt);

    // Mettre à jour le mot de passe dans la base de données
    user.password = hashedNewPassword;
    await user.save();

    //(`Mot de passe changé avec succès pour l'utilisateur ${userId}`);

    return res.status(200).json({ 
      message: 'Mot de passe changé avec succès.' 
    });

  } catch (error) {
    console.error('Erreur lors du changement de mot de passe :', error);
    return res.status(500).json({ 
      message: 'Une erreur est survenue lors du changement de mot de passe.' 
    });
  }
};

module.exports.deleteUser = async (req, res) => {
  try {
    // Vérifier si l'utilisateur connecté est un admin
    const adminId = req.user?.id || req.userData?.id;
    const adminUser = await User.findById(adminId);
    
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({ 
        success: false,
        message: "Accès refusé. Seuls les administrateurs peuvent supprimer des utilisateurs." 
      });
    }

    const { userId } = req.params;

    // Validation de l'ID utilisateur
    if (!userId) {
      return res.status(400).json({ 
        success: false,
        message: "ID utilisateur requis." 
      });
    }

    // Empêcher un admin de se supprimer lui-même
    if (userId === adminId) {
      return res.status(400).json({ 
        success: false,
        message: "Un administrateur ne peut pas se supprimer lui-même." 
      });
    }

    // Vérifier si l'utilisateur existe
    const userToDelete = await User.findById(userId);
    if (!userToDelete) {
      return res.status(404).json({ 
        success: false,
        message: "Utilisateur non trouvé." 
      });
    }

    // Sauvegarder les informations de l'utilisateur pour la réponse et les logs
    const userInfo = {
      id: userToDelete._id,
      firstName: userToDelete.firstName,
      lastName: userToDelete.lastName,
      email: userToDelete.email,
      telephone: userToDelete.telephone,
      role: userToDelete.role,
      nbre_actions: userToDelete.nbre_actions || 0,
      dividende: userToDelete.dividende || 0
    };

    // Supprimer l'utilisateur de la base de données
    await User.findByIdAndDelete(userId);

    // Log de l'action de suppression
   /*  //(`✅ Utilisateur supprimé avec succès:`, {
      admin_id: adminId,
      admin_name: `${adminUser.firstName} ${adminUser.lastName}`,
      deleted_user: userInfo,
      timestamp: new Date().toISOString()
    });
 */
    return res.status(200).json({
      success: true,
      message: "Utilisateur supprimé avec succès.",
      deleted_user: {
        firstName: userInfo.firstName,
        lastName: userInfo.lastName,
        email: userInfo.email,
        telephone: userInfo.telephone,
        role: userInfo.role,
        ...(userInfo.role === 'actionnaire' && {
          nbre_actions: userInfo.nbre_actions,
          dividende: userInfo.dividende
        })
      },
      deleted_at: new Date().toISOString(),
      deleted_by: {
        admin_id: adminId,
        admin_name: `${adminUser.firstName} ${adminUser.lastName}`
      }
    });
    
  } catch (error) {
    console.error('Erreur suppression utilisateur:', error);
    res.status(500).json({ 
      success: false,
      message: "Erreur interne du serveur lors de la suppression.", 
      error: error.message 
    });
  }
};
module.exports.deleteMultipleUsers = async (req, res) => {
  try {
    // Vérifier si l'utilisateur connecté est un admin
    const adminId = req.user?.id || req.userData?.id;
    const adminUser = await User.findById(adminId);
    
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({ 
        success: false,
        message: "Accès refusé. Seuls les administrateurs peuvent supprimer des utilisateurs." 
      });
    }

    const { userIds } = req.body;

    // Validation des données
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ 
        success: false,
        message: "Liste d'IDs utilisateur requise (array non vide)." 
      });
    }

    // Limiter le nombre de suppressions simultanées
    if (userIds.length > 50) {
      return res.status(400).json({ 
        success: false,
        message: "Impossible de supprimer plus de 50 utilisateurs à la fois." 
      });
    }

    // Empêcher un admin de se supprimer lui-même
    if (userIds.includes(adminId)) {
      return res.status(400).json({ 
        success: false,
        message: "Un administrateur ne peut pas se supprimer lui-même." 
      });
    }

    // Vérifier quels utilisateurs existent
    const usersToDelete = await User.find({ _id: { $in: userIds } });
    const foundUserIds = usersToDelete.map(user => user._id.toString());
    const notFoundIds = userIds.filter(id => !foundUserIds.includes(id));

    if (usersToDelete.length === 0) {
      return res.status(404).json({ 
        success: false,
        message: "Aucun utilisateur trouvé avec les IDs fournis." 
      });
    }

    // Sauvegarder les informations des utilisateurs pour les logs
    const deletedUsersInfo = usersToDelete.map(user => ({
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      telephone: user.telephone,
      role: user.role,
      nbre_actions: user.nbre_actions || 0,
      dividende: user.dividende || 0
    }));

    // Supprimer les utilisateurs
    const deleteResult = await User.deleteMany({ _id: { $in: foundUserIds } });

    // Log de l'action de suppression en lot
   /*  //(`✅ Suppression en lot effectuée:`, {
      admin_id: adminId,
      admin_name: `${adminUser.firstName} ${adminUser.lastName}`,
      deleted_count: deleteResult.deletedCount,
      deleted_users: deletedUsersInfo,
      not_found_ids: notFoundIds,
      timestamp: new Date().toISOString()
    }); */

    return res.status(200).json({
      success: true,
      message: `${deleteResult.deletedCount} utilisateur(s) supprimé(s) avec succès.`,
      summary: {
        total_requested: userIds.length,
        successfully_deleted: deleteResult.deletedCount,
        not_found: notFoundIds.length
      },
      deleted_users: deletedUsersInfo.map(user => ({
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        ...(user.role === 'actionnaire' && {
          nbre_actions: user.nbre_actions,
          dividende: user.dividende
        })
      })),
      not_found_ids: notFoundIds,
      deleted_at: new Date().toISOString(),
      deleted_by: {
        admin_id: adminId,
        admin_name: `${adminUser.firstName} ${adminUser.lastName}`
      }
    });
    
  } catch (error) {
    console.error('Erreur suppression multiple utilisateurs:', error);
    res.status(500).json({ 
      success: false,
      message: "Erreur interne du serveur lors de la suppression multiple.", 
      error: error.message 
    });
  }
};
module.exports.updateOwnProfile = async (req, res) => {
  try {
    const userId = req.user?.id || req.userData?.id;
    const { 
      firstName, 
      lastName, 
      email, 
      telephone, 
      adresse,
      nationalite,
      ville,
      pays,
      cni,
      dateNaissance
    } = req.body;

    // Vérifier que l'utilisateur existe
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: "Utilisateur non trouvé" 
      });
    }

    // Préparer les données à mettre à jour (tous les champs modifiables)
    let updateData = {};
    
    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (email !== undefined) {
      // Vérifier si l'email est déjà utilisé par un autre utilisateur
      const emailExists = await User.findOne({ 
        email, 
        _id: { $ne: userId } 
      });
      
      if (emailExists) {
        return res.status(400).json({ 
          success: false,
          message: "Cet email est déjà utilisé par un autre utilisateur" 
        });
      }
      
      updateData.email = email;
    }
    if (telephone !== undefined) updateData.telephone = telephone;
    if (adresse !== undefined) updateData.adresse = adresse;
    if (nationalite !== undefined) updateData.nationalite = nationalite;
    if (ville !== undefined) updateData.ville = ville;
    if (pays !== undefined) updateData.pays = pays;
    if (dateNaissance !== undefined) updateData.dateNaissance = dateNaissance;
if (cni !== undefined) updateData.cni = cni;
    // Mettre à jour l'utilisateur
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true }
    ).select('-password');

    return res.status(200).json({
      success: true,
      message: "Profil mis à jour avec succès",
      user: updatedUser
    });
    
  } catch (error) {
    console.error('Erreur mise à jour profil:', error);
    res.status(500).json({ 
      success: false,
      message: "Erreur interne du serveur", 
      error: error.message 
    });
  }
};
module.exports.sendWhatsAppMessage = sendWhatsAppMessage;
module.exports.formatPhoneNumber = formatPhoneNumber;
module.exports.sendWhatsAppDocument = sendWhatsAppDocument;
module.exports.sendWhatsAppMessagePass = sendWhatsAppMessagePass;



