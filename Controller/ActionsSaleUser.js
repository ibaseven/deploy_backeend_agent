const fs = require("fs");
const path = require("path");
const AWS = require("aws-sdk");
const axios = require("axios");
const qs = require("qs");
const User = require("../Models/User");
const AuthorizedSeller = require("../Models/AuthorizedSeller");
const ActionsPurchase = require("../Models/ActionsPurchase");
const {
  generateContractPDF,
  generateContractBetweenUserPDF,
} = require("../Services/contractGenerator");
const ActionsSaleUser = require("../Models/ActionsSaleForUser");
const INSTANCE_ID = process.env.ULTRAMSG_INSTANCE_ID;
const TOKEN = process.env.ULTRAMSG_TOKEN;

// ✅ Configurer S3
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

// ✅ Formater le numéro
function formatPhoneNumber(phone) {
  return phone.replace(/\D/g, "");
}

// ✅ Upload PDF sur S3
async function uploadPdfToS3(localFilePath, s3Key) {
  const fileContent = fs.readFileSync(localFilePath);

  const params = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: s3Key,
    Body: fileContent,
    ContentType: "application/pdf",
  };

  const result = await s3.upload(params).promise();
  return result.Location;
}

// ✅ Envoi PDF via UltraMsg
async function sendWhatsAppDocument(
  phoneNumber,
  pdfUrl,
  filename,
  caption = ""
) {
  const data = qs.stringify({
    token: TOKEN,
    to: formatPhoneNumber(phoneNumber),
    filename: filename,
    document: pdfUrl,
    caption: caption,
  });

  const config = {
    method: "post",
    url: `https://api.ultramsg.com/${INSTANCE_ID}/messages/document`,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    data: data,
  };

  const response = await axios(config);
  return response.data;
}

// ✅ Envoi message texte via UltraMsg WhatsApp
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


// ==============================
// Route de test complète
// ==============================
const updateTransactionStatusForTest = async (req, res) => {
  try {
    const { transactionId, status, testMode = true } = req.body;

    if (!transactionId || !status) {
      return res
        .status(400)
        .json({
          success: false,
          message: "transactionId et status sont requis",
        });
    }

    const allowedStatuses = ["completed", "failed", "cancelled", "pending"];
    if (!allowedStatuses.includes(status)) {
      return res
        .status(400)
        .json({
          success: false,
          message: `Statut invalide. Autorisés: ${allowedStatuses.join(", ")}`,
        });
    }

    if (!testMode)
      return res
        .status(403)
        .json({ success: false, message: "Route uniquement pour tests" });

    const actionsPurchase = await ActionsPurchase.findById(transactionId);
    if (!actionsPurchase)
      return res
        .status(404)
        .json({ success: false, message: "Transaction non trouvée" });

    const user = await User.findById(actionsPurchase.user_id);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "Utilisateur non trouvé" });

    // ============================
    // CAS: completed
    // ============================
    if (status === "completed") {
      if (actionsPurchase.status === "completed") {
        return res
          .status(200)
          .json({
            success: true,
            message: "Transaction déjà complétée",
            alreadyProcessed: true,
          });
      }

      // 🔹 Ajouter les actions au user
      const nombreActions = actionsPurchase.nombre_actions || 0;
      user.nbre_actions = (user.nbre_actions || 0) + nombreActions;
      await user.save(); // sauvegarde la mise à jour dans la base
      //console.log(nombreActions);

      // 1️⃣ Générer le PDF
      const pdfBuffer = await generateContractPDF(actionsPurchase, user);
      const tempDir = path.join(__dirname, "../temp");
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

      const filename = `Contrat_Actions_TEST_${
        actionsPurchase._id
      }_${Date.now()}.pdf`;
      const tempPath = path.join(tempDir, filename);
      fs.writeFileSync(tempPath, pdfBuffer);

      // 2️⃣ Upload sur S3
      const s3Key = `contrats/${filename}`;
      let s3Url;
      try {
        s3Url = await uploadPdfToS3(tempPath, s3Key);
        console.log("✅ PDF uploadé sur S3:", s3Url);
      } catch (err) {
        console.error("❌ Erreur upload S3:", err.message);
      }

      // 3️⃣ Envoi WhatsApp
      let sendResult = null;
      if (s3Url) {
        const caption = `🧪 [MODE TEST] Félicitations ${user.firstName}! Voici votre contrat de cession d'actions.`;
        try {
          sendResult = await sendWhatsAppDocument(
            user.telephone,
            s3Url,
            filename,
            caption
          );
          console.log("✅ Document WhatsApp envoyé !", sendResult);
        } catch (err) {
          console.error("❌ Erreur envoi PDF WhatsApp:", err.message);
        }
      }

      // 4️⃣ Fallback message texte si l’envoi PDF échoue
      if (!sendResult) {
        await sendWhatsAppMessage(
          user.telephone,
          `🧪 [MODE TEST] Votre achat a été confirmé. Le contrat sera envoyé ultérieurement.`
        );
      }

      // 5️⃣ Nettoyage local
      fs.unlinkSync(tempPath);

      return res
        .status(200)
        .json({
          success: true,
          message: "Test completed: PDF envoyé ou fallback texte",
          sendResult,
          nombreActionsUser: user.nombreActions,
        });
    } else {
      // CAS autres statuts
      const message = `🧪 [MODE TEST] Votre transaction a été ${status}.`;
      await sendWhatsAppMessage(user.telephone, message);
      return res
        .status(200)
        .json({ success: true, message: "Test autres statuts envoyé" });
    }
  } catch (error) {
    console.error("❌ Erreur update statut:", error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};
const buydividendeswithoseruser = async (req, res) => {
  try {
    const userId = req.user?.id || req.userData?.id;
    const { nbre_actions, telephone, montant } = req.body;

  
    const vendeur = await User.findById(userId);
    if (!vendeur) {
      return res.status(404).json({ message: "Vendeur introuvable" });
    }
    // Vérifier que le vendeur est autorisé en base de données
    const authorizedSeller = await AuthorizedSeller.findOne({ telephone: vendeur.telephone, actif: true });
    if (!authorizedSeller) {
      return res.status(403).json({
        message: "Seul le vendeur autorisé peut vendre des actions",
      });
    }

    // 👤 Vérifier l'acheteur
    const acheteur = await User.findOne({ telephone });
    if (!acheteur) {
      return res.status(404).json({ message: "Acheteur introuvable" });
    }

    // ✅ Vérifier le stock d'actions
    if ((vendeur.nbre_actions || 0) < nbre_actions) {
      return res.status(400).json({ message: "Stock d'actions insuffisant" });
    }

    // 📝 Créer la transaction
    const transaction = new ActionsSaleUser({
      vendeur: vendeur._id,
      acheteur: acheteur._id,
      nbre_actions,
      telephone_vendeur: vendeur.telephone,
      telephone_acheteur: acheteur.telephone,
      montant,
    });
    await transaction.save();

    // ➖ Débiter le vendeur
    vendeur.nbre_actions -= nbre_actions;
    await vendeur.save();

    // ➕ Créditer l'acheteur
    const anciennes_actions = acheteur.nbre_actions || 0;
    acheteur.nbre_actions = anciennes_actions + nbre_actions;
    await acheteur.save();

    // 📄 GÉNÉRATION DU CONTRAT PDF + UPLOAD S3 + ENVOI WHATSAPP
    let pdfUploadSuccess = false;
    let whatsappSentToAcheteur = false;
    let whatsappSentToVendeur = false;
    let s3Url = null;
    let localFilePath = null;

    try {
      // 1️⃣ Préparer les données pour le PDF
      const purchaseData = {
        nombre_actions: nbre_actions,
        nbre_actions: nbre_actions,
        price_per_share: montant / nbre_actions,
        prix_unitaire: montant / nbre_actions,
        montant: montant,
        montant_total: montant,
      };

      const userData = {
        firstName: acheteur.firstName ,
        lastName: acheteur.lastName,
        nom_complet: `${acheteur.firstName} ${
          acheteur.lastName
        }`.trim(),
        dateNaissance: acheteur.dateNaissance || acheteur.date_naissance ,
        nationalite:
          acheteur.nationalite || acheteur.nationality ,
        adresse:
          acheteur.adresse ||
          `${acheteur.ville || "Dakar"} -- ${acheteur.pays || "Sénégal"}`,
        ville: acheteur.ville || "Dakar",
        pays: acheteur.pays || "Sénégal",
        carte_identite:
          acheteur.carte_identite || acheteur.num_carte_identite || "",
        ville_carte: acheteur.ville_carte || acheteur.ville || "Dakar",
        nombre_actions: acheteur.nbre_actions,
        nbre_actions: acheteur.nbre_actions,
      };

      const vendeurData = {
        firstName: vendeur.firstName,
        lastName: vendeur.lastName,
        nom_complet:
          `${vendeur.firstName || ""} ${vendeur.lastName || ""}`.trim() ||
          "Ibrahima Diakhaté",
        nationalite: vendeur.nationalite || "sénégalaise",
        adresse: vendeur.adresse || "Dakar -- Sénégal",
        ville: vendeur.ville || "Dakar",
        pays: vendeur.pays || "Sénégal",
        carte_identite: vendeur.carte_identite || "",
        ville_carte: vendeur.ville_carte || vendeur.ville || "Dakar",
        nbre_actions: vendeur.nbre_actions + nbre_actions, // Actions AVANT la vente
      };

      // 2️⃣ Générer le PDF
      console.log("📄 Génération du PDF...");
      const pdfBuffer = await generateContractBetweenUserPDF(
        purchaseData,
        userData,
        vendeurData
      );

      // 3️⃣ Sauvegarder temporairement en local
      const contractsDir = path.join(__dirname, "../contracts");
      if (!fs.existsSync(contractsDir)) {
        fs.mkdirSync(contractsDir, { recursive: true });
      }

      const fileName = `contrat_${transaction._id}_${Date.now()}.pdf`;
      localFilePath = path.join(contractsDir, fileName);
      fs.writeFileSync(localFilePath, pdfBuffer);
      //console.log(`✅ PDF sauvegardé localement : ${fileName}`);

      // 4️⃣ Upload sur S3
      //console.log('☁️ Upload du PDF sur S3...');
      const s3Key = `contracts/${fileName}`;
      s3Url = await uploadPdfToS3(localFilePath, s3Key);
      pdfUploadSuccess = true;
      console.log(`✅ PDF uploadé sur S3 : ${s3Url}`);

      // 5️⃣ Mettre à jour la transaction avec l'URL S3
      transaction.contrat_pdf = s3Url;
      transaction.contrat_pdf_nom = fileName;
      transaction.contrat_pdf_s3_key = s3Key;
      await transaction.save();

      // 6️⃣ Envoyer le PDF par WhatsApp à l'acheteur
      const nomCompletAcheteur =
        `${acheteur.firstName} ${acheteur.lastName}`.trim();

      /* try {
        //console.log(`📱 Envoi WhatsApp à l'acheteur : ${acheteur.telephone}`);
        const captionAcheteur = `Félicitations ${nomCompletAcheteur} ! Votre contrat de cession de ${nbre_actions.toLocaleString("fr-FR")} actions a été généré avec succès. Veuillez consulter le document PDF ci-joint. DIOKO GROUP SAS`;

        await sendWhatsAppDocument(
          acheteur.telephone,
          s3Url,
          fileName,
          captionAcheteur
        );
        whatsappSentToAcheteur = true;
        //console.log(`✅ PDF envoyé par WhatsApp à l'acheteur`);
      } catch (whatsappError) {
        console.error(`❌ Erreur WhatsApp acheteur:`, whatsappError.message);
      } */

      // 7️⃣ Envoyer le PDF par WhatsApp au vendeur
      const nomCompletVendeur = vendeurData.nom_complet;

      try {
        //console.log(`📱 Envoi WhatsApp au vendeur : ${vendeur.telephone}`);
        const captionVendeur = `Notification de vente Bonjour ${nomCompletVendeur},Vous avez vendu ${nbre_actions.toLocaleString("fr-FR")} actions à ${nomCompletAcheteur}. Montant : ${montant.toLocaleString("fr-FR")} FCFA Contrat. DIOKO GROUP SAS`;

        await sendWhatsAppMessage(
          vendeur.telephone,
          captionVendeur
        );
        whatsappSentToVendeur = true;
        //console.log(`✅ PDF envoyé par WhatsApp au vendeur`);
      } catch (whatsappError) {
        console.error(`❌ Erreur WhatsApp vendeur:`, whatsappError.message);

        // Fallback : envoyer un message texte avec le lien
        try {
          const fallbackMessage = `Notification de vente Bonjour ${nomCompletVendeur}, Vous avez vendu ${nbre_actions.toLocaleString("fr-FR")} actions à ${nomCompletAcheteur}. Montant : ${montant.toLocaleString("fr-FR")} FCFA Contrat : ${s3Url} DIOKO GROUP SAS`;
          await sendWhatsAppMessage(vendeur.telephone, fallbackMessage);
          console.log(`✅ Message texte de fallback envoyé au vendeur`);
        } catch (fallbackError) {
          console.error(`❌ Erreur fallback vendeur:`, fallbackError.message);
        }
      }
   /*    try {
        const telephonePdg = "+221773878232";
        const captionToThePdg = `Notification de vente Bonjour ${nomCompletVendeur}, a vendu ${nbre_actions.toLocaleString("fr-FR")} actions à ${nomCompletAcheteur}. Montant : ${montant.toLocaleString("fr-FR")} FCFA DIOKO GROUP SAS`;
        await sendWhatsAppMessage(telephonePdg, captionToThePdg);
      } catch (error) {
        console.log(`✅ Message texte de fallback envoyé au vendeur`);
      }  */
      // 8️⃣ Supprimer le fichier local (optionnel)
      try {
        if (localFilePath && fs.existsSync(localFilePath)) {
          fs.unlinkSync(localFilePath);
          console.log(`🗑️ Fichier local supprimé : ${fileName}`);
        }
      } catch (deleteError) {
        console.warn(
          `⚠️ Impossible de supprimer le fichier local:`,
          deleteError.message
        );
      }

      // ✅ Réponse succès complète
      return res.status(200).json({
        message: "success",
        type: "success",
        transaction: {
          ...transaction.toObject(),
          contrat_disponible: true,
          contrat_nom: fileName,
          contrat_url: s3Url,
        },
        vendeur: {
          tel: vendeur.telephone,
          nouvelles_actions: vendeur.nbre_actions,
          whatsapp_envoye: whatsappSentToVendeur,
        },
        acheteur: {
          tel: acheteur.telephone,
          anciennes_actions: anciennes_actions,
          nouvelles_actions: acheteur.nbre_actions,
          actions_achetees: nbre_actions,
          whatsapp_envoye: whatsappSentToAcheteur,
        },
        contrat: {
          genere: true,
          upload_s3: pdfUploadSuccess,
          nom_fichier: fileName,
          url_s3: s3Url,
          whatsapp_acheteur: whatsappSentToAcheteur,
          whatsapp_vendeur: whatsappSentToVendeur,
        },
      });
    } catch (pdfError) {
      console.error("❌ Erreur lors de la génération/upload du PDF:", pdfError);

      // La transaction a réussi mais pas le PDF
      return res.status(200).json({
        message: "Vente effectue avec sucess",
        type: "success",
        transaction,
        vendeur: {
          tel: vendeur.telephone,
          nouvelles_actions: vendeur.nbre_actions,
        },
        acheteur: {
          tel: acheteur.telephone,
          anciennes_actions: anciennes_actions,
          nouvelles_actions: acheteur.nbre_actions,
          actions_achetees: nbre_actions,
        },
        contrat: {
          genere: false,
          erreur: pdfError.message,
        },
      });
    }
  } catch (error) {
    console.error("❌ Erreur transaction:", error);
    return res.status(500).json({
      message: "Erreur interne du serveur",
      error: error.message,
    });
  }
};
const getAllDividendesbuywithOtherUser = async (req, res) => {
  try {
    const userId = req?.user?.id;

    if (!userId) {
      return res.status(401).json({ message: "Utilisateur non authentifié" });
    }

    // 🔎 Récupérer toutes les transactions liées à cet utilisateur
    const transactions = await ActionsSaleUser.find({
   
    })
      .populate("vendeur", "firstName lastName email telephone nbre_actions")
      .populate("acheteur", "firstName lastName email telephone nbre_actions")
    

    // Post-traitement pour ajouter fullName et valeurPortefeuille
    const transactionsFormatted = transactions.map((t) => {
      const vendeur = t.vendeur
        ? {
            ...t.vendeur.toObject(),
            fullName: `${t.vendeur.nom || ""} ${t.vendeur.prenom || ""}`.trim(),
            valeurPortefeuille: (t.vendeur.nbre_actions || 0) * 10000,
          }
        : null;

      const acheteur = t.acheteur
        ? {
            ...t.acheteur.toObject(),
            fullName: `${t.acheteur.nom || ""} ${
              t.acheteur.prenom || ""
            }`.trim(),
            valeurPortefeuille: (t.acheteur.nbre_actions || 0) * 10000,
          }
        : null;

      return {
        ...t.toObject(),
        vendeur,
        acheteur,
        montant: t.nbre_actions * 1000, // Exemple : 1 action = 1000 FCFA
      };
    });

    return res.status(200).json({
      message: "Transactions récupérées avec succès ✅",
      total: transactionsFormatted.length,
      transactions: transactionsFormatted,
    });
  } catch (error) {
    console.error("Erreur getAllDividendesbuywithOtherUser:", error);
    return res.status(500).json({ message: "Erreur interne du serveur" });
  }
};
module.exports = {
  updateTransactionStatusForTest,
  buydividendeswithoseruser,
  getAllDividendesbuywithOtherUser,
};
