const OTP = require('../Models/OTP');
const User = require('../Models/User');

/**
 * Valider un partenaire
 */
const validatePartner = async (userId, telephonePartenaire) => {
  if (!userId || !telephonePartenaire) {
    return { isValid: false, partenaire: null };
  }
  
  try {
    // Vérifier si le partenaire existe
    const partenaire = await User.findOne({ 
      telephone: telephonePartenaire,
      status: 'active',
      isBlocked: { $ne: true }
    });
    
    // Vérifier si le partenaire n'est pas l'utilisateur lui-même
    if (!partenaire || partenaire._id.toString() === userId.toString()) {
      return { isValid: false, partenaire: null };
    }
    
    return { isValid: true, partenaire };
  } catch (error) {
    console.error('❌ Erreur validation partenaire:', error);
    return { isValid: false, partenaire: null };
  }
};

/**
 * ✅ FONCTION MANQUANTE : Vérifier si un utilisateur a déjà référé un partenaire
 */
const hasUserReferredPartner = async (userId, telephonePartenaire) => {
  if (!userId || !telephonePartenaire) return false;
  
  try {
    // Vérifier si l'utilisateur a déjà un telephonePartenaire défini
    const user = await User.findById(userId).select('telephonePartenaire');
    
    if (!user) {
      console.log(`❌ Utilisateur ${userId} non trouvé`);
      return false;
    }
    
    // Vérifier si l'utilisateur a déjà un telephonePartenaire
    const hasPartner = user.telephonePartenaire && user.telephonePartenaire.trim() !== '';
    
    console.log(`🔍 Utilisateur ${userId} - A déjà un partenaire: ${hasPartner ? 'OUI' : 'NON'}`);
    
    if (hasPartner) {
      console.log(`📞 Partenaire actuel: ${user.telephonePartenaire}`);
    }
    
    return hasPartner;
    
  } catch (error) {
    console.error('❌ Erreur lors de la vérification du partenaire référent:', error);
    return false; // En cas d'erreur, considérer comme n'ayant pas de partenaire (plus sûr)
  }
};

/**
 * Générer un OTP et l'envoyer
 */
const generateOTP = async (partenaire, acheteur, ipAddress = null, userAgent = null) => {
  try {
    // ✅ CORRECTION DU CHEMIN D'IMPORT

     const { sendWhatsAppMessageSafe } = require('../Controller/actionsPurchaseController');
    
    // Supprimer les anciens OTP pour ce partenaire
    await OTP.deleteMany({ 
      userId: partenaire._id,
      type: 'partner_verification'
    });
    
    // Générer un code OTP à 6 chiffres
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Créer un nouveau OTP avec expiration (5 minutes)
    const otpDocument = new OTP({
      userId: partenaire._id,
      code: otpCode,
      type: 'partner_verification',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
      metadata: {
        acheteurId: acheteur._id,
        acheteurNom: `${acheteur.firstName} ${acheteur.lastName}`,
        acheteurTelephone: acheteur.telephone,
        ipAddress: ipAddress,
        userAgent: userAgent
      }
    });
    
    await otpDocument.save();
    
    // Message WhatsApp pour le partenaire
    const otpMessage = `🔐 CODE DE VÉRIFICATION - Dioko

Bonjour ${acheteur.firstName} ${acheteur.lastName}, voici le 🔢 Code de vérification : ${otpCode}

Ce code expire dans 5 minutes.

Si vous n'êtes pas au courant de cette demande, ignorez ce message.

L'équipe Dioko`;

    // Envoyer l'OTP via WhatsApp
    await sendWhatsAppMessageSafe(acheteur.telephone, otpMessage);
    
    console.log(`📱 OTP ${otpCode} envoyé au partenaire ${partenaire.telephone}`);
    
    return { success: true, otpId: otpDocument._id };
  } catch (error) {
    console.error('❌ Erreur génération OTP:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Vérifier un OTP
 */
const verifyOTP = async (partnerId, providedOTP) => {
  try {
    // Rechercher l'OTP valide
    const otpDocument = await OTP.findValidOTP(partnerId, providedOTP);
    
    if (!otpDocument) {
      // Vérifier s'il y a un OTP pour ce partenaire (pour donner un meilleur message)
      const existingOTP = await OTP.findOne({
        userId: partnerId,
        type: 'partner_verification',
        expiresAt: { $gt: new Date() }
      });
      
      if (existingOTP) {
        // Incrémenter les tentatives
        await existingOTP.incrementAttempts();
        
        if (existingOTP.attempts >= 2) { // 3e tentative (0,1,2)
          return { 
            success: false, 
            message: 'Trop de tentatives. Demandez un nouveau code.',
            shouldDelete: true 
          };
        }
        
        return { 
          success: false, 
          message: `Code incorrect. ${3 - existingOTP.attempts - 1} tentative(s) restante(s).` 
        };
      }
      
      return { success: false, message: 'Code OTP invalide ou expiré' };
    }
    
    // Marquer l'OTP comme utilisé
    await otpDocument.markAsUsed();
    
    console.log(`✅ OTP vérifié avec succès pour le partenaire ${partnerId}`);
    
    return { 
      success: true, 
      message: 'Code vérifié avec succès',
      otpId: otpDocument._id 
    };
  } catch (error) {
    console.error('❌ Erreur vérification OTP:', error);
    return { success: false, message: 'Erreur lors de la vérification' };
  }
};

/**
 * Vérifier les limites de débit (rate limiting)
 */
const checkRateLimit = async (partnerId, timeWindowMinutes = 60, maxAttempts = 3) => {
  try {
    const timeWindow = new Date(Date.now() - timeWindowMinutes * 60 * 1000);
    
    // Compter les OTP créés dans la dernière heure
    const recentOTPs = await OTP.countDocuments({
      userId: partnerId,
      type: 'partner_verification',
      createdAt: { $gte: timeWindow }
    });
    
    if (recentOTPs >= maxAttempts) {
      const oldestOTP = await OTP.findOne({
        userId: partnerId,
        type: 'partner_verification',
        createdAt: { $gte: timeWindow }
      }).sort({ createdAt: 1 });
      
      if (oldestOTP) {
        const waitTime = Math.ceil((timeWindowMinutes * 60 * 1000 - (Date.now() - oldestOTP.createdAt)) / (60 * 1000));
        return { allowed: false, waitTime: Math.max(1, waitTime) };
      }
    }
    
    return { allowed: true };
  } catch (error) {
    console.error('❌ Erreur rate limit:', error);
    return { allowed: true }; // En cas d'erreur, autoriser
  }
};

/**
 * Nettoyer les anciens OTP d'un utilisateur
 */
const cleanUserOTPs = async (userId, type = 'partner_verification') => {
  try {
    const result = await OTP.deleteMany({
      userId: userId,
      type: type,
      $or: [
        { used: true },
        { expiresAt: { $lt: new Date() } },
        { attempts: { $gte: 3 } }
      ]
    });
    
    console.log(`🧹 ${result.deletedCount} OTP nettoyés pour l'utilisateur ${userId}`);
    return result.deletedCount;
  } catch (error) {
    console.error('❌ Erreur nettoyage OTP:', error);
    return 0;
  }
};

/**
 * ✅ FONCTION BONUS : Obtenir l'historique des partenaires d'un utilisateur
 */
const getUserPartnerHistory = async (userId) => {
  try {
    const ActionsPurchase = require('../Models/ActionsPurchase');
    const mongoose = require('mongoose');
    
    const history = await ActionsPurchase.aggregate([
      {
        $match: {
          user_id: new mongoose.Types.ObjectId(userId),
          telephonePartenaire: { $exists: true, $ne: null },
          status: 'completed'
        }
      },
      {
        $group: {
          _id: '$telephonePartenaire',
          nombreAchats: { $sum: 1 },
          montantTotal: { $sum: '$montant_total' },
          bonusTotal: { $sum: '$bonusMontant' },
          premierAchat: { $min: '$createdAt' },
          dernierAchat: { $max: '$createdAt' }
        }
      },
      {
        $lookup: {
          from: 'users',
          let: { tel: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$telephone', '$$tel'] } } },
            { $project: { firstName: 1, lastName: 1, telephone: 1 } }
          ],
          as: 'partenaireInfo'
        }
      },
      { $unwind: { path: '$partenaireInfo', preserveNullAndEmptyArrays: true } },
      { $sort: { dernierAchat: -1 } }
    ]);
    
    return history;
  } catch (error) {
    console.error('❌ Erreur historique partenaires:', error);
    return [];
  }
};

/**
 * ✅ FONCTION ALTERNATIVE : Version simplifiée pour éviter les erreurs de modèle
 */
const hasUserReferredPartnerSimple = async (userId, telephonePartenaire) => {
  try {
    // Import dynamique pour éviter les problèmes de dépendances circulaires
    const mongoose = require('mongoose');
    
    const count = await mongoose.connection.db.collection('actionspurchases').countDocuments({
      user_id: new mongoose.Types.ObjectId(userId),
      telephonePartenaire: telephonePartenaire,
      status: 'completed'
    });
    
    console.log(`🔍 Utilisateur ${userId} - Achats avec ${telephonePartenaire}: ${count}`);
    return count > 0;
    
  } catch (error) {
    console.error('❌ Erreur vérification partenaire (version simple):', error);
    return false;
  }
};

// ✅ EXPORTER TOUTES LES FONCTIONS
module.exports = {
  validatePartner,
  generateOTP,
  verifyOTP,
  checkRateLimit,
  cleanUserOTPs,
  hasUserReferredPartner,        // ✅ Fonction principale
  hasUserReferredPartnerSimple,  // ✅ Version alternative
  getUserPartnerHistory
};