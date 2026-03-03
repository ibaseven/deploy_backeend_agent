const jwt = require('jsonwebtoken');
const User = require('../Models/User');
const secretKey = process.env.JWT_KEY;

const authenticate = async (req, res, next) => {
  try {
    // Récupération du token d'autorisation
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Pour extraire le token après "Bearer "
    //("Token reçu:", token);
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Accès refusé. Aucun token fourni."
      });
    }

    // Vérification du token
    const decoded = jwt.verify(token, secretKey);
    //("Token décodé:", decoded);

    //("Tentative de vérification du token");
    
    // CORRECTION: Récupérer l'ID utilisateur du token au lieu du rôle
    const userId = decoded.data?.id || decoded.id || decoded.userId;
    const userEmail = decoded.data?.email || decoded.email;
    
    if (!userId && !userEmail) {
      return res.status(401).json({
        success: false,
        message: "Token invalide. ID ou email utilisateur non trouvé."
      });
    }
    
    // CORRECTION: Chercher l'utilisateur par ID ou email, pas par rôle
    let user;
    if (userId) {
      user = await User.findById(userId);
    } else if (userEmail) {
      user = await User.findOne({ email: userEmail });
    }
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Utilisateur non trouvé."
      });
    }
    
    // Vérifier si l'utilisateur est actif (optionnel)
    if (user.status === 'inactive' || user.status === 'suspended') {
      return res.status(401).json({
        success: false,
        message: "Compte utilisateur désactivé."
      });
    }
    
    // Ajout des informations utilisateur à la requête
    req.user = {
      id: user._id,
      role: user.role,
      telephone: user.telephone,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email
    };
    
  /*   //("Utilisateur authentifié:", {
      id: user._id,
      telephone: user.telephone,
      role: user.role,
      name: `${user.firstName} ${user.lastName}`
    });
     */
    next();
  } catch (error) {
    console.error("Erreur d'authentification:", error);
    return res.status(401).json({
      success: false,
      message: "Token invalide",
      error: error.message
    });
  }
};
const requireAdmin = async (req, res, next) => {
  try {
    // Vérifier si l'utilisateur est authentifié
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Utilisateur non authentifié. Utilisez d'abord le middleware authenticate."
      });
    }

    // Vérifier si l'utilisateur a le rôle admin
    if (req.user.role !== 'admin') {
      //(`Accès admin refusé pour l'utilisateur: ${req.user.email} (rôle: ${req.user.role})`);
      return res.status(403).json({
        success: false,
        message: "Accès refusé. Privilèges administrateur requis."
      });
    }

    //(`Accès admin accordé à: ${req.user.firstName} ${req.user.lastName} (${req.user.email})`);
    next();
  } catch (error) {
    console.error("Erreur vérification admin:", error);
    return res.status(500).json({
      success: false,
      message: "Erreur lors de la vérification des privilèges admin",
      error: error.message
    });
  }
};
const authenticateTokenAndUserData = (req, res, next) => {
    const token = req.headers.authorization
    
    if (!token) {
        return res.status(403).send({ message: 'Accès interdit' });
    }

    jwt.verify(token, secretKey, (err, decoded) => {
        if (err) {
            return res.status(403).send({ message: 'Token invalide' });
        }

        req.user = decoded.data;
        next();
    });
};

module.exports = {authenticate,requireAdmin,authenticateTokenAndUserData};