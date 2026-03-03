const AuthorizedSeller = require('../Models/AuthorizedSeller');
const User = require('../Models/User');

// Obtenir tous les vendeurs autorisés
exports.getAllAuthorizedSellers = async (req, res) => {
  try {
    const sellers = await AuthorizedSeller.find();
    res.status(200).json({
      success: true,
      count: sellers.length,
      data: sellers
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erreur lors de la récupération des vendeurs autorisés",
      error: error.message
    });
  }
};

// Ajouter un vendeur autorisé
exports.addAuthorizedSeller = async (req, res) => {
  try {
    const { telephone } = req.body;

    if (!telephone) {
      return res.status(400).json({
        success: false,
        message: "Le numéro de téléphone est requis"
      });
    }

    // Vérifier que le numéro existe dans la base utilisateurs
    const user = await User.findOne({ telephone });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Aucun utilisateur trouvé avec ce numéro de téléphone"
      });
    }

    const seller = await AuthorizedSeller.create({
      telephone,
      nom: `${user.firstName || ''} ${user.lastName || ''}`.trim() || undefined,
    });

    res.status(201).json({
      success: true,
      message: `${user.firstName || telephone} ajouté comme vendeur autorisé`,
      data: seller
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Ce numéro existe déjà dans la liste des vendeurs autorisés"
      });
    }
    res.status(500).json({
      success: false,
      message: "Erreur lors de l'ajout du vendeur autorisé",
      error: error.message
    });
  }
};

// Supprimer un vendeur autorisé
exports.removeAuthorizedSeller = async (req, res) => {
  try {
    const { telephone } = req.params;
    const seller = await AuthorizedSeller.findOneAndDelete({ telephone });

    if (!seller) {
      return res.status(404).json({
        success: false,
        message: "Vendeur autorisé non trouvé"
      });
    }

    res.status(200).json({
      success: true,
      message: "Vendeur autorisé supprimé avec succès"
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erreur lors de la suppression du vendeur autorisé",
      error: error.message
    });
  }
};

// Activer / désactiver un vendeur autorisé
exports.toggleAuthorizedSeller = async (req, res) => {
  try {
    const { telephone } = req.params;
    const seller = await AuthorizedSeller.findOne({ telephone });

    if (!seller) {
      return res.status(404).json({
        success: false,
        message: "Vendeur autorisé non trouvé"
      });
    }

    seller.actif = !seller.actif;
    await seller.save();

    res.status(200).json({
      success: true,
      message: `Vendeur ${seller.actif ? 'activé' : 'désactivé'} avec succès`,
      data: seller
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erreur lors de la mise à jour du vendeur autorisé",
      error: error.message
    });
  }
};
