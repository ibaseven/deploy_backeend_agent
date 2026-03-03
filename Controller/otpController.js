const { validatePartner, generateOTP, verifyOTP, checkRateLimit, cleanUserOTPs } = require('../Utils/otp-utils');

/**
 * Route pour vérifier l'OTP - POST /api/verify-otp
 */
const verifyOTPForPartner = async (req, res) => {
  try {
    const { telephonePartenaire, otpCode } = req.body;
    const userId = req.user?.id || req.userData?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Utilisateur non authentifié"
      });
    }

    if (!telephonePartenaire || !otpCode) {
      return res.status(400).json({
        success: false,
        message: "Numéro de téléphone et code OTP requis"
      });
    }

    // Validation du format OTP
    if (!/^[0-9]{6}$/.test(otpCode)) {
      return res.status(400).json({
        success: false,
        message: "Le code OTP doit contenir exactement 6 chiffres"
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Utilisateur non trouvé"
      });
    }

    // Valider le partenaire
    const { isValid, partenaire } = await validatePartner(userId, telephonePartenaire);
    
    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: "Partenaire invalide"
      });
    }

    // Vérifier l'OTP
    const otpVerification = await verifyOTP(partenaire._id, otpCode);
    
    if (!otpVerification.success) {
      // Nettoyer si trop de tentatives
      if (otpVerification.shouldDelete) {
        await cleanUserOTPs(partenaire._id);
      }
      
      return res.status(400).json({
        success: false,
        message: otpVerification.message
      });
    }

    return res.status(200).json({
      success: true,
      message: "Code OTP vérifié avec succès",
      data: {
        partenaireId: partenaire._id,
        partenaireNom: `${partenaire.firstName} ${partenaire.lastName}`,
        telephonePartenaire: partenaire.telephone,
        verified: true,
        otpId: otpVerification.otpId
      }
    });

  } catch (error) {
    console.error('❌ Erreur vérification OTP:', error);
    return res.status(500).json({
      success: false,
      message: "Erreur serveur lors de la vérification",
      error: error.message
    });
  }
};

/**
 * Route pour renvoyer un OTP - POST /api/resend-otp
 */
const resendOTPForPartner = async (req, res) => {
  try {
    const { telephonePartenaire } = req.body;
    const userId = req.user?.id || req.userData?.id;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Utilisateur non authentifié"
      });
    }

    if (!telephonePartenaire) {
      return res.status(400).json({
        success: false,
        message: "Numéro de téléphone partenaire requis"
      });
    }

    // Validation du format de téléphone
    if (!/^\+?[0-9]{8,15}$/.test(telephonePartenaire)) {
      return res.status(400).json({
        success: false,
        message: "Format de téléphone invalide"
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Utilisateur non trouvé"
      });
    }

    // Valider le partenaire
    const { isValid, partenaire } = await validatePartner(userId, telephonePartenaire);
    
    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: "Partenaire invalide ou vous ne pouvez pas être votre propre partenaire"
      });
    }

    // Vérifier les limites de renvoi
    const rateLimitCheck = await checkRateLimit(partenaire._id);
    
    if (!rateLimitCheck.allowed) {
      return res.status(429).json({
        success: false,
        message: `Trop de tentatives. Réessayez dans ${rateLimitCheck.waitTime} minute(s).`
      });
    }

    // Nettoyer les anciens OTP avant d'en créer un nouveau
    await cleanUserOTPs(partenaire._id);

    // Générer et envoyer un nouveau OTP
    const otpResult = await generateOTP(partenaire, user, ipAddress, userAgent);
    
    if (!otpResult.success) {
      return res.status(500).json({
        success: false,
        message: "Erreur lors de l'envoi de l'OTP"
      });
    }

    return res.status(200).json({
      success: true,
      message: `Nouveau code OTP envoyé au partenaire ${telephonePartenaire}`,
      data: {
        partenaireNom: `${partenaire.firstName} ${partenaire.lastName}`,
        telephonePartenaire: partenaire.telephone,
        expiresIn: 300, // 5 minutes en secondes
        otpId: otpResult.otpId
      }
    });

  } catch (error) {
    console.error('❌ Erreur renvoi OTP:', error);
    return res.status(500).json({
      success: false,
      message: "Erreur serveur lors du renvoi de l'OTP",
      error: error.message
    });
  }
};

module.exports = {
  verifyOTPForPartner,
  resendOTPForPartner
};