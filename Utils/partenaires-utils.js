 const ActionsPurchase = require('../Models/ActionsPurchase');
  const User = require('../Models/User');
   const OTP = require('../Models/OTP'); // Assumant qu'un modèle OTP existe
    const { sendWhatsAppMessageSafe } = require('../Controllers/userController'); // Ajustez le chemin
    
const hasReferredPartner = async (userId, telephonePartenaire) => {
  if (!userId || !telephonePartenaire) return false;
  
  try {
    const count = await ActionsPurchase.countDocuments({
      user_id: userId,
      telephonePartenaire: telephonePartenaire,
      status: 'completed' // Compter seulement les achats complétés
    });
    
    return count > 0;
  } catch (error) {
    console.error('❌ Erreur lors de la vérification du partenaire:', error);
    return false;
  }
};

/**
 * Vérifie si un partenaire est valide (existe et n'est pas l'utilisateur lui-même)
 */
const validatePartner = async (userId, telephonePartenaire) => {
  if (!userId || !telephonePartenaire) {
    return { isValid: false, partenaire: null };
  }
  
  try {
   
    // Vérifier si le partenaire existe
    const partenaire = await User.findOne({ 
      telephone: telephonePartenaire,
      status: 'active', // S'assurer que le partenaire est actif
      isBlocked: { $ne: true } // S'assurer qu'il n'est pas bloqué
    });
    
    // Vérifier si le partenaire n'est pas l'utilisateur lui-même
    if (!partenaire || partenaire._id.toString() === userId.toString()) {
      return { isValid: false, partenaire: null };
    }
    
    return { isValid: true, partenaire };
  } catch (error) {
    console.error('❌ Erreur lors de la validation du partenaire:', error);
    return { isValid: false, partenaire: null };
  }
};

/**
 * Génère un OTP et l'envoie au partenaire
 */
const generateOTPForPartner = async (partenaire, acheteur) => {
  try {
   
    
    // Générer un code OTP à 6 chiffres
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Supprimer les anciens OTP pour ce partenaire
    await OTP.deleteMany({ 
      userId: partenaire._id,
      type: 'partner_verification'
    });
    
    // Créer un nouveau OTP avec expiration (5 minutes)
    const otpDocument = new OTP({
      userId: partenaire._id,
      code: otpCode,
      type: 'partner_verification',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
      metadata: {
        acheteurId: acheteur._id,
        acheteurNom: `${acheteur.firstName} ${acheteur.lastName}`,
        acheteurTelephone: acheteur.telephone
      }
    });
    
    await otpDocument.save();
    
    // Message WhatsApp pour le partenaire
    const otpMessage = `🔐 CODE DE VÉRIFICATION - Dioko


Bonjour ${acheteur.firstName} ${acheteur.lastName}, voici le 🔢 Code de vérification : ${otpCode}

⏰ Ce code expire dans 5 minutes.

Si vous n'êtes pas au courant de cette demande, ignorez ce message.

L'équipe Dioko`;

    // Envoyer l'OTP via WhatsApp
    await sendWhatsAppMessageSafe(acheteur.telephone, otpMessage);
    
   // console.log(`📱 OTP ${otpCode} envoyé au partenaire ${partenaire.telephone}`);
    
    return { success: true, otpCode }; // En production, ne pas retourner le code
  } catch (error) {
    console.error('❌ Erreur lors de la génération de l\'OTP:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Vérifie l'OTP fourni par le partenaire
 */
const verifyOTPForPartner = async (partenaireId, providedOTP) => {
  try {
    const OTP = require('../Models/OTP');
    
    // Rechercher l'OTP valide
    const otpDocument = await OTP.findOne({
      userId: partenaireId,
      code: providedOTP,
      type: 'partner_verification',
      expiresAt: { $gt: new Date() }, // Non expiré
      used: { $ne: true } // Pas encore utilisé
    });
    
    if (!otpDocument) {
      return { success: false, message: 'Code OTP invalide ou expiré' };
    }
    
    // Marquer l'OTP comme utilisé
    otpDocument.used = true;
    otpDocument.usedAt = new Date();
    await otpDocument.save();
    
   // console.log(`✅ OTP vérifié avec succès pour le partenaire ${partenaireId}`);
    
    return { success: true, message: 'OTP vérifié avec succès' };
  } catch (error) {
    console.error('❌ Erreur lors de la vérification de l\'OTP:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Calcule et attribue un bonus au partenaire
 */
const attribuerBonusPartenaire = async (partenaire, montantTotal, tauxBonus = 0.1) => {
  if (!partenaire || !montantTotal) {
    return { success: false, bonus: 0 };
  }
  
  try {
    const bonus = Math.round(montantTotal * tauxBonus); // Arrondir le bonus
    
    // Ajouter le bonus au dividende du partenaire
    partenaire.dividende = (partenaire.dividende || 0) + bonus;
    await partenaire.save();
    
    // Enregistrer l'historique du bonus
    const BonusHistory = require('../Models/BonusHistory'); // Assumant qu'un modèle existe
    await BonusHistory.create({
      partenaireId: partenaire._id,
      montantBonus: bonus,
      montantAchat: montantTotal,
      tauxBonus: tauxBonus,
      type: 'parrainage',
      dateAttribution: new Date()
    });
    
  //  console.log(`💸 Bonus de ${bonus} FCFA ajouté au partenaire (${partenaire.telephone})`);
    
    return { success: true, bonus };
  } catch (error) {
    console.error('❌ Erreur lors de l\'attribution du bonus:', error);
    return { success: false, bonus: 0 };
  }
};

/**
 * Récupère l'historique des bonus d'un partenaire
 */
const getBonusHistory = async (partenaireId, limit = 10) => {
  try {
    const BonusHistory = require('../Models/BonusHistory');
    const ActionsPurchase = require('../Models/ActionsPurchase');
    
    const bonusHistory = await BonusHistory.find({ partenaireId })
      .sort({ dateAttribution: -1 })
      .limit(limit)
      .lean();
    
    // Récupérer aussi les informations des achats liés
    const bonusWithDetails = await Promise.all(
      bonusHistory.map(async (bonus) => {
        const purchase = await ActionsPurchase.findOne({
          partenaireId: partenaireId,
          bonusMontant: bonus.montantBonus,
          bonusPartenaireAttribue: true
        }).populate('user_id', 'firstName lastName telephone');
        
        return {
          ...bonus,
          acheteur: purchase?.user_id || null
        };
      })
    );
    
    return bonusWithDetails;
  } catch (error) {
    console.error('❌ Erreur lors de la récupération de l\'historique des bonus:', error);
    return [];
  }
};

/**
 * Statistiques des bonus d'un partenaire
 */
const getPartnerStats = async (partenaireId) => {
  try {
    const ActionsPurchase = require('../Models/ActionsPurchase');
    const BonusHistory = require('../Models/BonusHistory');
    
    const stats = await Promise.all([
      // Nombre total de filleuls
      ActionsPurchase.distinct('user_id', { 
        partenaireId: partenaireId, 
        status: 'completed' 
      }),
      // Total des bonus reçus
      BonusHistory.aggregate([
        { $match: { partenaireId: partenaireId } },
        { $group: { _id: null, totalBonus: { $sum: '$montantBonus' } } }
      ]),
      // Nombre d'achats parrainés
      ActionsPurchase.countDocuments({ 
        partenaireId: partenaireId, 
        status: 'completed',
        bonusPartenaireAttribue: true 
      })
    ]);
    
    return {
      nombreFilleuls: stats[0].length,
      totalBonusRecus: stats[1][0]?.totalBonus || 0,
      nombreAchatsParraines: stats[2]
    };
  } catch (error) {
    console.error('❌ Erreur lors du calcul des statistiques:', error);
    return {
      nombreFilleuls: 0,
      totalBonusRecus: 0,
      nombreAchatsParraines: 0
    };
  }
};

module.exports = {
  hasReferredPartner,
  validatePartner,
  generateOTPForPartner,
  verifyOTPForPartner,
  attribuerBonusPartenaire,
  getBonusHistory,
  getPartnerStats
};