const { validationResult } = require("express-validator");
const Entreprise = require("../Models/Entreprise");
const User = require("../Models/User");
const axios = require("axios");
const qs = require("qs");
// Fonction pour générer l'URL de téléchargement S3hghgh
const generateDownloadUrl = (fileName) => {
  if (!fileName) return null;

  // URL publique S3 (si votre bucket est public)
  return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;

  // Ou si vous préférez une URL via votre API
  // return `${process.env.BASE_URL}/api/download/${fileName}`;
};
const INSTANCE_ID = process.env.ULTRAMSG_INSTANCE_ID;
const TOKEN = process.env.ULTRAMSG_TOKEN;

// Fonction pour envoyer un message WhatsApp via UltraMsg
async function sendWhatsAppMessage(phoneNumber, message) {
  try {
    if (!INSTANCE_ID || !TOKEN) {
      throw new Error('ULTRAMSG_INSTANCE_ID et ULTRAMSG_TOKEN doivent être configurés dans .env');
    }
    const formattedPhone = formatPhoneNumber(phoneNumber);
    const data = qs.stringify({ token: TOKEN, to: formattedPhone, body: message });
    const response = await axios.post(
      `https://api.ultramsg.com/${INSTANCE_ID}/messages/chat`,
      data,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    return { success: true, response: response.data };
  } catch (error) {
    if (error.response) {
      throw new Error(`Erreur API UltraMsg (${error.response.status}): ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}
function formatPhoneNumber(telephone) {
  // Supprimer tous les caractères non numériques
  let cleaned = telephone.replace(/\D/g, '');
  
  // Validation de base - s'assurer que ce n'est pas vide
  if (!cleaned) {
    throw new Error('Numéro de téléphone invalide');
  }
  return cleaned;
}
module.exports.updateAllDividendesFrom2025 = async (req, res) => {
  try {
    const entreprises = await Entreprise.find({ annee: { $gte: 2025 } });

    if (!entreprises.length) {
      return res.status(404).json({
        success: false,
        message: "Aucune entreprise enregistrée à partir de l'année 2025.",
      });
    }

    // Réinitialiser les dividendes de tous les actionnaires à zéro
    await User.updateMany({ role: "actionnaire" }, { $set: { dividende: 0 } });

    const actionnaires = await User.find({ role: "actionnaire" });

    // Calcul des dividendes pour chaque entreprise de 2025+
    entreprises.forEach((entreprise) => {
      const benefice = entreprise.total_benefice;

      actionnaires.forEach(async (user) => {
        const parts = user.nbre_actions || 0;
        const dividendeAjoute = (benefice * parts) / 100000;

        // Mise à jour utilisateur
        await User.findByIdAndUpdate(user._id, {
          $inc: { dividende: dividendeAjoute },
        });
      });
    });

    return res.status(200).json({
      success: true,
      message:
        "Tous les dividendes ont été recalculés à partir de l'année 2025.",
    });
  } catch (error) {
    console.error("Erreur updateAllDividendesFrom2025:", error);
    return res.status(500).json({
      success: false,
      message: "Erreur lors du recalcul des dividendes",
      error: error.message,
    });
  }
};

// Fonction pour recalculer et additionner les dividendes
const addDividendesToActionnaires = async (nouveauBenefice) => {
  try {
    // Récupérer tous les actionnaires
    const actionnaires = await User.find({ role: "actionnaire" });

    if (actionnaires.length === 0) {
      //('Aucun actionnaire trouvé');
      return;
    }

    // Calculer et additionner les nouveaux dividendes pour chaque actionnaire
    const updatePromises = actionnaires.map(async (actionnaire) => {
      // Formule: nouveau_dividende = nouveauBenefice * nbre_actions / 100000
      const nouveauDividende =
        (nouveauBenefice * (actionnaire.nbre_actions || 0)) / 100000;

      // Additionner aux anciens dividendes
      const ancienDividende = actionnaire.dividende || 0;
      actionnaire.dividende = ancienDividende + nouveauDividende;

      //(`Actionnaire ${actionnaire.firstName} ${actionnaire.lastName}:
      /*    Ancien dividende: ${ancienDividende}
        Nouveau dividende calculé: ${nouveauDividende}
        Total dividende: ${actionnaire.dividende}`); */

      return actionnaire.save();
    });

    await Promise.all(updatePromises);

    //(`Dividendes mis à jour et additionnés pour ${actionnaires.length} actionnaires`);
  } catch (error) {
    console.error("Erreur lors de l'addition des dividendes:", error);
    throw error;
  }
};

// Créer une nouvelle entreprise
module.exports.createEntreprise = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: "Erreurs de validation",
      errors: errors.array(),
    });
  }

  try {
    const { total_benefice, annee } = req.body;
    let rapportFileName = null;
    let rapportUrl = null;

    // Vérifier si une entreprise existe déjà pour cette année
    const existingEntreprise = await Entreprise.findOne({ annee });
    if (existingEntreprise) {
      return res.status(409).json({
        success: false,
        message: `Une entreprise existe déjà pour l'année ${annee}`,
      });
    }

    // Gérer l'upload du fichier rapport s'il existe
    if (req.uploadedFiles && req.uploadedFiles.length > 0) {
      rapportFileName = req.uploadedFiles[0]; // Nom du fichier uploadé
      rapportUrl = generateDownloadUrl(rapportFileName);

      //(`Fichier rapport uploadé: ${rapportFileName}`);
      //(`URL de téléchargement: ${rapportUrl}`);
    }

    // Créer la nouvelle entreprise
    const entrepriseData = {
      total_benefice,
      annee,
      rapport: rapportFileName, // Stocker le nom du fichier
      rapportUrl: rapportUrl, // Stocker l'URL de téléchargement
    };

    const entreprise = await Entreprise.create(entrepriseData);

    // Additionner les nouveaux dividendes aux anciens pour tous les actionnaires
    await addDividendesToActionnaires(total_benefice);

    return res.status(201).json({
      success: true,
      message:
        "Entreprise créée avec succès et dividendes additionnés aux anciens",
      entreprise: {
        id: entreprise._id,
        annee: entreprise.annee,
        total_benefice: entreprise.total_benefice,
        rapport: entreprise.rapport,
        rapportUrl: entreprise.rapportUrl,
        createdAt: entreprise.createdAt,
      },
      fichier: rapportFileName
        ? {
            nom: rapportFileName,
            urlTelecharger: rapportUrl,
            message: "Fichier rapport uploadé avec succès",
          }
        : null,
    });
  } catch (error) {
    console.error("Erreur création entreprise:", error);
    res.status(500).json({
      success: false,
      message: "Erreur interne du serveur",
      error: error.message,
    });
  }
};

// Obtenir toutes les entreprises avec URLs de téléchargement
module.exports.getAllEntreprises = async (req, res) => {
  try {
    const entreprises = await Entreprise.find().sort({ annee: -1 });

    // Ajouter les URLs de téléchargement
    const entreprisesWithUrls = entreprises.map((ent) => ({
      id: ent._id,
      annee: ent.annee,
      total_benefice: ent.total_benefice,
      rapport: ent.rapport,
      rapportUrl: generateDownloadUrl(ent.rapport),
      createdAt: ent.createdAt,
      updatedAt: ent.updatedAt,
    }));

    return res.status(200).json({
      success: true,
      count: entreprises.length,
      entreprises: entreprisesWithUrls,
    });
  } catch (error) {
    console.error("Erreur récupération entreprises:", error);
    res.status(500).json({
      success: false,
      message: "Erreur interne du serveur",
      error: error.message,
    });
  }
};

// Obtenir une entreprise par ID avec URL de téléchargement
module.exports.getEntrepriseById = async (req, res) => {
  try {
    const { id } = req.params;
    const entreprise = await Entreprise.findById(id);

    if (!entreprise) {
      return res.status(404).json({
        success: false,
        message: "Entreprise non trouvée",
      });
    }

    const entrepriseWithUrl = {
      id: entreprise._id,
      annee: entreprise.annee,
      total_benefice: entreprise.total_benefice,
      rapport: entreprise.rapport,
      rapportUrl: generateDownloadUrl(entreprise.rapport),
      createdAt: entreprise.createdAt,
      updatedAt: entreprise.updatedAt,
    };

    return res.status(200).json({
      success: true,
      entreprise: entrepriseWithUrl,
    });
  } catch (error) {
    console.error("Erreur récupération entreprise:", error);
    res.status(500).json({
      success: false,
      message: "Erreur interne du serveur",
      error: error.message,
    });
  }
};

// Obtenir une entreprise par année avec URL de téléchargement
module.exports.getEntrepriseByYear = async (req, res) => {
  try {
    const { annee } = req.params;
    const entreprise = await Entreprise.findOne({ annee: parseInt(annee) });

    if (!entreprise) {
      return res.status(404).json({
        success: false,
        message: `Aucune entreprise trouvée pour l'année ${annee}`,
      });
    }

    const entrepriseWithUrl = {
      id: entreprise._id,
      annee: entreprise.annee,
      total_benefice: entreprise.total_benefice,
      rapport: entreprise.rapport,
      rapportUrl: generateDownloadUrl(entreprise.rapport),
      createdAt: entreprise.createdAt,
      updatedAt: entreprise.updatedAt,
    };

    return res.status(200).json({
      success: true,
      entreprise: entrepriseWithUrl,
    });
  } catch (error) {
    console.error("Erreur récupération entreprise par année:", error);
    res.status(500).json({
      success: false,
      message: "Erreur interne du serveur",
      error: error.message,
    });
  }
};

// Mettre à jour les bénéfices d'une entreprise
module.exports.updateBenefices = async (req, res) => {
  try {
    const { id } = req.params;
    const { total_benefice } = req.body;

    if (total_benefice === undefined || total_benefice === null) {
      return res.status(400).json({
        success: false,
        message: "Le montant des bénéfices est requis",
      });
    }

    if (total_benefice < 0) {
      return res.status(400).json({
        success: false,
        message: "Les bénéfices ne peuvent pas être négatifs",
      });
    }

    const entreprise = await Entreprise.findByIdAndUpdate(
      id,
      { total_benefice },
      { new: true, runValidators: true }
    );

    if (!entreprise) {
      return res.status(404).json({
        success: false,
        message: "Entreprise non trouvée",
      });
    }

    // Additionner les nouveaux dividendes aux anciens
    await addDividendesToActionnaires(total_benefice);

    const entrepriseWithUrl = {
      id: entreprise._id,
      annee: entreprise.annee,
      total_benefice: entreprise.total_benefice,
      rapport: entreprise.rapport,
      rapportUrl: generateDownloadUrl(entreprise.rapport),
      createdAt: entreprise.createdAt,
      updatedAt: entreprise.updatedAt,
    };

    return res.status(200).json({
      success: true,
      message: "Bénéfices mis à jour avec succès et dividendes additionnés",
      entreprise: entrepriseWithUrl,
    });
  } catch (error) {
    console.error("Erreur mise à jour bénéfices:", error);
    res.status(500).json({
      success: false,
      message: "Erreur interne du serveur",
      error: error.message,
    });
  }
};

// Mettre à jour une entreprise complète avec nouveau fichier
module.exports.updateEntreprise = async (req, res) => {
  try {
    const { id } = req.params;
    const { total_benefice, annee } = req.body;
    let rapportFileName = null;
    let rapportUrl = null;

    // Vérifier si une autre entreprise existe pour cette année (si l'année change)
    if (annee) {
      const existingEntreprise = await Entreprise.findOne({
        annee: annee,
        _id: { $ne: id },
      });

      if (existingEntreprise) {
        return res.status(409).json({
          success: false,
          message: `Une autre entreprise existe déjà pour l'année ${annee}`,
        });
      }
    }

    // Gérer l'upload du nouveau fichier s'il existe
    if (req.uploadedFiles && req.uploadedFiles.length > 0) {
      rapportFileName = req.uploadedFiles[0];
      rapportUrl = generateDownloadUrl(rapportFileName);

      //(`Nouveau fichier rapport uploadé: ${rapportFileName}`);
    }

    // Préparer les données de mise à jour
    const updateData = {};
    if (total_benefice !== undefined)
      updateData.total_benefice = total_benefice;
    if (annee !== undefined) updateData.annee = annee;
    if (rapportFileName) {
      updateData.rapport = rapportFileName;
      updateData.rapportUrl = rapportUrl;
    }

    const entreprise = await Entreprise.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!entreprise) {
      return res.status(404).json({
        success: false,
        message: "Entreprise non trouvée",
      });
    }

    // Additionner les dividendes si les bénéfices ont changé
    if (total_benefice !== undefined) {
      await addDividendesToActionnaires(total_benefice);
    }

    const entrepriseWithUrl = {
      id: entreprise._id,
      annee: entreprise.annee,
      total_benefice: entreprise.total_benefice,
      rapport: entreprise.rapport,
      rapportUrl: generateDownloadUrl(entreprise.rapport),
      createdAt: entreprise.createdAt,
      updatedAt: entreprise.updatedAt,
    };

    return res.status(200).json({
      success: true,
      message:
        "Entreprise mise à jour avec succès" +
        (total_benefice !== undefined ? " et dividendes additionnés" : ""),
      entreprise: entrepriseWithUrl,
      fichier: rapportFileName
        ? {
            nom: rapportFileName,
            urlTelecharger: rapportUrl,
            message: "Nouveau fichier rapport uploadé avec succès",
          }
        : null,
    });
  } catch (error) {
    console.error("Erreur mise à jour entreprise:", error);
    res.status(500).json({
      success: false,
      message: "Erreur interne du serveur",
      error: error.message,
    });
  }
};

// Supprimer une entreprise
module.exports.deleteEntreprise = async (req, res) => {
  try {
    const { id } = req.params;

    const entreprise = await Entreprise.findByIdAndDelete(id);

    if (!entreprise) {
      return res.status(404).json({
        success: false,
        message: "Entreprise non trouvée",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Entreprise supprimée avec succès",
      entreprise: {
        id: entreprise._id,
        annee: entreprise.annee,
        total_benefice: entreprise.total_benefice,
        rapport: entreprise.rapport,
      },
    });
  } catch (error) {
    console.error("Erreur suppression entreprise:", error);
    res.status(500).json({
      success: false,
      message: "Erreur interne du serveur",
      error: error.message,
    });
  }
};

// Ajouter une nouvelle année de bénéfices avec upload de fichier
module.exports.addNewYearBenefices = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: "Erreurs de validation",
      errors: errors.array(),
    });
  }

  try {
    const { annee } = req.body;
    let rapportFileName = null;
    let rapportUrl = null;

   

    // Gérer l'upload du fichier rapport s'il existe
    if (req.uploadedFiles && req.uploadedFiles.length > 0) {
      rapportFileName = req.uploadedFiles[0];
      rapportUrl = generateDownloadUrl(rapportFileName);
    }

    // Créer la nouvelle entreprise
    const entrepriseData = {
      annee,
      rapport: rapportFileName,
      rapportUrl: rapportUrl,
    };

    const entreprise = await Entreprise.create(entrepriseData);

    let resumeDividendes = null;
    let messagesEnvoyes = 0;
    let messagesEchoues = 0;

    // ✅ Ajouter les dividendes **seulement à partir de l'année 2025**
    if (parseInt(annee) >= 2025) {
      // Nouvelle formule de calcul des dividendes
      // Pourcentage = Nombre d'actions / 10000
      // Dividende = 70000 x Pourcentage d'action

      const actionnaires = await User.find({ role: "actionnaire" }).select(
        "-password"
      );

      let nouveauxDividendesTotal = 0;

      // Fonction pour mettre en pause entre les lots
      const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

      // Traiter les actionnaires par lots de 50
      const TAILLE_LOT = 50;
      const DELAI_ENTRE_LOTS = 2000; // 2 secondes entre chaque lot

      for (let i = 0; i < actionnaires.length; i += TAILLE_LOT) {
        const lot = actionnaires.slice(i, i + TAILLE_LOT);
        const numeroLot = Math.floor(i / TAILLE_LOT) + 1;
        const totalLots = Math.ceil(actionnaires.length / TAILLE_LOT);
        
        console.log(`📦 Traitement du lot ${numeroLot}/${totalLots} (${lot.length} actionnaires)`);

        // Traiter chaque actionnaire du lot
        for (const actionnaire of lot) {
          const nbreActions = actionnaire.nbre_actions || 0;
          const pourcentage = nbreActions / 10000;
          const nouveauDividende = 70000 * pourcentage;

          // Ajouter le nouveau dividende à l'ancien
          const ancienDividende = actionnaire.dividende || 0;
          const nouveauTotalDividende = ancienDividende + nouveauDividende;
          actionnaire.dividende = nouveauTotalDividende;
          await actionnaire.save();

          nouveauxDividendesTotal += nouveauDividende;

          // Préparer le message WhatsApp personnalisé
          const nomComplet =
            `${actionnaire.firstName || ""} ${
              actionnaire.lastName || ""
            }`.trim() || "Cher Actionnaire";
          const pourcentageFormate = pourcentage;
          const nouveauDividendeFormate = nouveauDividende.toLocaleString(
            "fr-FR",
            { minimumFractionDigits: 2 }
          );
          const totalDividendeFormate = nouveauTotalDividende.toLocaleString(
            "fr-FR",
            { minimumFractionDigits: 2 }
          );

          const message = ` 
Bonjour ${nomComplet},
Nous avons le plaisir de vous annoncer que vos dividendes sont disponibles sur https://actionnaire.diokoclient.com/
Actions : ${nbreActions.toLocaleString("fr-FR")}
Pourcentage dans la société : ${pourcentageFormate}%
Dioko Group`;

          // Envoyer le message WhatsApp
          if (actionnaire.telephone) {
            try {
              await sendWhatsAppMessage(actionnaire.telephone, message);
              messagesEnvoyes++;
              console.log(
                `  ✅ Message envoyé à ${nomComplet} (${actionnaire.telephone})`
              );
            } catch (error) {
              messagesEchoues++;
              console.error(
                `  ❌ Erreur envoi message à ${nomComplet}:`,
                error.message
              );
            }
          } else {
            messagesEchoues++;
            console.warn(`  ⚠️ Pas de numéro de téléphone pour ${nomComplet}`);
          }
        }

        // Pause entre les lots (sauf pour le dernier lot)
        if (i + TAILLE_LOT < actionnaires.length) {
          console.log(`⏳ Pause de ${DELAI_ENTRE_LOTS / 1000}s avant le prochain lot...`);
          await sleep(DELAI_ENTRE_LOTS);
        }
      }

      console.log(`✅ Traitement terminé: ${messagesEnvoyes} messages envoyés, ${messagesEchoues} échecs`);

      // Récupérer les actionnaires mis à jour pour le résumé
      const actionnairesUpdated = await User.find({
        role: "actionnaire3",
      }).select("-password");
      const totalDividendesDistribues = actionnairesUpdated.reduce(
        (sum, act) => sum + (act.dividende || 0),
        0
      );

      resumeDividendes = {
        totalActionnaires: actionnaires.length,
        totalDividendesDistribues: parseFloat(
          totalDividendesDistribues.toFixed(2)
        ),
        nouveauxDividendesDistribues: parseFloat(
          nouveauxDividendesTotal.toFixed(2)
        ),
        formuleUtilisee:
          "Pourcentage = nbre_actions / 10000, Dividende = 70000 x Pourcentage",
        notifications: {
          messagesEnvoyes,
          messagesEchoues,
          total: actionnaires.length,
          lotsTraites: Math.ceil(actionnaires.length / TAILLE_LOT),
          tailleLot: TAILLE_LOT,
        },
      };
    }

    return res.status(201).json({
      success: true,
      message:
        `Nouvelle année ${annee} ajoutée avec succès.` +
        (resumeDividendes
          ? ` Dividendes additionnés aux anciens. ${messagesEnvoyes} notification(s) envoyée(s).`
          : " Dividendes non calculés pour cette année."),
      entreprise: {
        id: entreprise._id,
        annee: entreprise.annee,
        total_benefice: entreprise.total_benefice,
        rapport: entreprise.rapport,
        rapportUrl: entreprise.rapportUrl,
        createdAt: entreprise.createdAt,
      },
      resumeDividendes,
      fichier: rapportFileName
        ? {
            nom: rapportFileName,
            urlTelecharger: rapportUrl,
            message: "Fichier rapport uploadé avec succès",
          }
        : null,
    });
  } catch (error) {
    console.error("Erreur ajout nouvelle année:", error);
    res.status(500).json({
      success: false,
      message: "Erreur interne du serveur",
      error: error.message,
    });
  }
};

// Fonction pour télécharger un fichier (optionnelle si vous voulez passer par votre API)
module.exports.downloadRapport = async (req, res) => {
  try {
    const { fileName } = req.params;

    // Vérifier que le fichier existe dans la base de données
    const entreprise = await Entreprise.findOne({ rapport: fileName });
    if (!entreprise) {
      return res.status(404).json({
        success: false,
        message: "Fichier non trouvé",
      });
    }

    // Rediriger vers l'URL S3
    const downloadUrl = generateDownloadUrl(fileName);
    return res.redirect(downloadUrl);
  } catch (error) {
    console.error("Erreur téléchargement:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors du téléchargement",
      error: error.message,
    });
  }
};

// Fonction pour récupérer toutes les entreprises avec leurs fichiers (alias pour getAllEntreprises)
module.exports.getAllEntreprisesWithFiles = module.exports.getAllEntreprises;
