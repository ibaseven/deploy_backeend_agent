const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');


const generateContractPDF = async (purchaseData, userData) => {
  return new Promise((resolve, reject) => {
    try {
      // Créer un nouveau document PDF
      const doc = new PDFDocument({
        size: 'A4',
        margins: {
          top: 60,
          bottom: 60,
          left: 60,
          right: 60
        }
      });

      // Buffer pour stocker le PDF
      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(buffers);
        resolve(pdfBuffer);
      });

      // === GESTION DU LOGO ===
      const logoPath = path.join(__dirname, '../assets/logo.jpeg');
      let logoAdded = false;
      
      try {
        // Vérifier si le fichier logo existe et est accessible
        if (fs.existsSync(logoPath)) {
          const stats = fs.statSync(logoPath);
          if (stats.isFile() && stats.size > 0) {
            // Centrer le logo
            const logoWidth = 80;
            const logoHeight = 60; // Hauteur fixe pour éviter la déformation
            const pageWidth = doc.page.width;
            const logoX = (pageWidth - logoWidth) / 2;
            
            doc.image(logoPath, logoX, 45, { 
              width: logoWidth,
              height: logoHeight,
              fit: [logoWidth, logoHeight], // Maintenir les proportions
              align: 'center'
            });
            logoAdded = true;
            doc.moveDown(4);
          }
        }
      } catch (logoError) {
        console.warn('Erreur lors du chargement du logo:', logoError.message);
        // Continuer sans logo
      }
      
      if (!logoAdded) {
        console.log('Logo non trouvé ou inaccessible, continuation sans logo');
        doc.moveDown(2);
      }

      // === CRÉATION DU LOGO TEXTE DIOKO EN CAS D'ABSENCE ===
      if (!logoAdded) {
        // Créer un logo texte stylisé
        doc.fontSize(20)
           .font('Helvetica-Bold')
           .fillColor('#2196F3') // Couleur bleue
           .text('DIOKO', { align: 'center' })
           .fillColor('black') // Retour au noir pour le reste
           .moveDown(1);
      }

      // Titre principal centré
      doc.fontSize(16)
         .font('Helvetica-Bold')
         .text('CONTRAT DE CESSION D\'ACTIONS', { align: 'center' })
         .moveDown(2);

      // Entre les soussignés
      doc.fontSize(11)
         .font('Helvetica')
         .text('Entre les soussignés :', { align: 'left' })
         .moveDown(0.5);

      // Société cédante
      doc.font('Helvetica')
         .text('la société ', { continued: true })
         .font('Helvetica-Bold')
         .text('DIOKO GROUP SAS', { continued: true })
         .font('Helvetica')
         .text(', société par actions simplifiée au capital de ', { continued: true })
         .font('Helvetica-Bold')
         .text('1 000 000 FCFA', { continued: true })
         .font('Helvetica')
         .text(', dont le siège social est situé à ', { continued: true })
         .font('Helvetica-Bold')
         .text('Sacré-Cœur 03 TF 21 926 / DG LOT N°137, Dakar - Sénégal', { continued: true })
         .font('Helvetica')
         .text(', immatriculée au Registre du Commerce et des Sociétés de Dakar sous le numéro ', { continued: true })
         .font('Helvetica-Bold')
         .text('010840446', { continued: true })
         .font('Helvetica')
         .text(' - RC : ', { continued: true })
         .font('Helvetica-Bold')
         .text('SN.DKR.2023.B.52045', { continued: true })
         .font('Helvetica')
         .text(', représentée par ', { continued: true })
         .font('Helvetica-Bold')
         .text('Monsieur Ibrahima Diakhaté', { continued: true })
         .font('Helvetica')
         .text(', en sa qualité de ', { continued: true })
         .font('Helvetica-Bold')
         .text('Directeur Général', { continued: true })
         .font('Helvetica')
         .text(',')
         .moveDown(0.5);

      // Et
      doc.font('Helvetica-Bold')
         .text('Et', { align: 'center' })
         .moveDown(0.5);

      // Bénéficiaire
      const fullName = `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || '[Nom complet]';
      const birthDate = userData.dateNaissance || '[date de naissance]';
      const nationality = userData.nationalite || '[nationalité]';
      const cni = userData.cni || '[nationalité]';
      const address = userData.adresse || `${userData.ville || '[ville]'}, ${userData.pays || '[pays]'}`;

      doc.font('Helvetica-Bold')
         .text(`Monsieur ${fullName}`, { continued: true })
         .font('Helvetica')
         .text(`, né le ${birthDate}, de nationalité ${nationality}, demeurant à ${address}, numero cni ${cni}`)
         .text('ci-après désigné ', { continued: true })
         .font('Helvetica-Bold')
         .text('« le Cessionnaire »', { continued: true })
         .font('Helvetica')
         .text(',')
         .moveDown();

      doc.text('Il a été convenu ce qui suit :')
         .moveDown(1);

      // Article 1
      doc.fontSize(12)
         .font('Helvetica-Bold')
         .text('Article 1 - Société concernée')
         .moveDown(0.3);

      doc.fontSize(11)
         .font('Helvetica')
         .text('Le présent contrat porte sur des actions de la société ', { continued: true })
         .font('Helvetica-Bold')
         .text('DIOKO GROUP SAS', { continued: true })
         .font('Helvetica')
         .text(', société par actions simplifiée au capital de ', { continued: true })
         .font('Helvetica-Bold')
         .text('1 000 000 FCFA', { continued: true })
         .font('Helvetica')
         .text(', dont le siège social est situé à ', { continued: true })
         .font('Helvetica-Bold')
         .text('Sacré-Cœur 03 TF 21 926 / DG LOT N°137, Dakar - Sénégal', { continued: true })
         .font('Helvetica')
         .text(', immatriculée au Registre du Commerce et des Sociétés de Dakar sous le numéro ', { continued: true })
         .font('Helvetica-Bold')
         .text('010840446', { continued: true })
         .font('Helvetica')
         .text(' - RC : ', { continued: true })
         .font('Helvetica-Bold')
         .text('SN.DKR.2023.B.52045', { continued: true })
         .font('Helvetica')
         .text(', représentée par ', { continued: true })
         .font('Helvetica-Bold')
         .text('Monsieur Ibrahima Diakhaté', { continued: true })
         .font('Helvetica')
         .text(', en sa qualité de ', { continued: true })
         .font('Helvetica-Bold')
         .text('Directeur Général', { continued: true })
         .font('Helvetica')
         .text('.')
         .moveDown(1);

      // Article 2 - Cession (NOUVEAU)
      doc.fontSize(12)
         .font('Helvetica-Bold')
         .text('Article 2 - Cession')
         .moveDown(0.3);

      // Fonction de formatage des montants
      const formatMontant = (montant) => {
        return montant.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
      };

      // Récupération sécurisée des données d'achat
      const rawNombreActionsAchat = purchaseData?.nombre_actions ?? 
                                     purchaseData?.nbre_actions ?? 
                                     purchaseData?.quantity ?? 
                                     0;
      const nombreActionsAchat = Number(rawNombreActionsAchat) || 0;
      
      // Récupération sécurisée des données utilisateur
      const rawNombreActionsTotal = userData?.nombre_actions ?? 
                                    userData?.nbre_actions ?? 
                                    userData?.actions ?? 
                                    0;
      const nombreActionsTotal = Number(rawNombreActionsTotal) || 0;
      
      // Récupération du prix par action et calcul du montant total
      const prixParAction = purchaseData?.price_per_share || purchaseData?.prix_unitaire || 0;
      const montantTotal = nombreActionsAchat * prixParAction;
      
      // Calculs des pourcentages
      const capitalTotal = 1000000; // Capital total de la société
      const pourcentageAchat = Number((nombreActionsAchat / capitalTotal * 100).toFixed(5));
   const pourcentageTotal = ((nombreActionsTotal / capitalTotal) * 100)


      doc.fontSize(11)
         .font('Helvetica')
         .text('Le présent contrat porte sur des actions de la société DIOKO GROUP SAS, société par actions simplifiée au capital de 1 000 000 FCFA, dont le siège social est situé à Sacré-Cœur 03 TF 21 926 / DG LOT N°137, Dakar - Sénégal, immatriculée au Registre du Commerce et des Sociétés de Dakar sous le numéro 010840446 - RC : SN.DKR.2023.B.52045, représentée par Monsieur Ibrahima Diakhaté, en sa qualité de Directeur Général cède et transporte par les présentes, sous les garanties ordinaires de fait et de droit, à M(me) ', { continued: true })
         .font('Helvetica-Bold')
         .text(`${fullName}`, { continued: true })
         .font('Helvetica')
         .text(' qui accepte, ', { continued: true })
         .font('Helvetica-Bold')
         .text(`${formatMontant(nombreActionsAchat)} actions`, { continued: true })
         .font('Helvetica')
         .text(' lui appartenant dans la société DIOKO GROUP SAS, soit ', { continued: true })
         .font('Helvetica-Bold')
         .text(`${pourcentageAchat}%`, { continued: true })
         .font('Helvetica')
         .text(' du capital de ladite société.')
         .moveDown(0.5);

      doc.text('Le cessionnaire détient désormais un total de ', { continued: true })
         .font('Helvetica-Bold')
         .text(`${formatMontant(nombreActionsTotal)} actions`, { continued: true })
         .font('Helvetica')
         .text(', représentant ', { continued: true })
         .font('Helvetica-Bold')
         .text(`${pourcentageTotal}%`, { continued: true })
         .font('Helvetica')
         .text(' du capital social de la société.')
         .moveDown(1);

      // Article 3 - Paiement (NOUVEAU)
      doc.fontSize(12)
         .font('Helvetica-Bold')
         .text('Article 3 - Paiement')
         .moveDown(0.3);

      // Formatage des montants sans utiliser toLocaleString pour éviter les problèmes d'affichage
      doc.fontSize(11)
         .font('Helvetica')
         .text('La présente cession est consentie et acceptée moyennant le prix de ', { continued: true })
         .font('Helvetica-Bold')
         .text(`${formatMontant(prixParAction)} Francs CFA`, { continued: true })
         .font('Helvetica')
         .text(' par action cédée, soit un prix total de ', { continued: true })
         .font('Helvetica-Bold')
         .text(`${formatMontant(montantTotal)} Francs CFA`, { continued: true })
         .font('Helvetica')
         .text(', ce que le Cédant reconnaît et accepte sans réserve.')
         .moveDown(1);

      // Article 4 - Effet de la cession (NOUVEAU)
      doc.fontSize(12)
         .font('Helvetica-Bold')
         .text('Article 4 - Effet de la cession')
         .moveDown(0.3);

      doc.fontSize(11)
         .font('Helvetica')
         .text('Le transfert de propriété prend effet à la date de signature du présent contrat. Le cessionnaire sera propriétaire et aura la jouissance des actions cédées à compter de la signature des présentes et sera subrogé dans tous ses droits et obligations attachés aux dites actions.')
         .moveDown(1);

      // Article 5 - Signification (NOUVEAU)
      doc.fontSize(12)
         .font('Helvetica-Bold')
         .text('Article 5 - Signification')
         .moveDown(0.3);

      doc.fontSize(11)
         .font('Helvetica')
         .text('La présente cession fera l\'objet d\'un bordereau de transfert signé du cédant et sera notifiée à la société par dépôt au siège social, contre remise par la direction générale d\'une attestation de dépôt, conformément à l\'article 763-1 de l\'Acte uniforme sur le droit des sociétés commerciales et du GIE.')
         .moveDown(1);

      // Article 6 - Déclaration Fiscale (NOUVEAU)
      doc.fontSize(12)
         .font('Helvetica-Bold')
         .text('Article 6 - Déclaration Fiscale')
         .moveDown(0.3);

      doc.fontSize(11)
         .font('Helvetica')
         .text('Pour la liquidation des droits d\'enregistrement, le cédant déclare que les actions cédées sont représentatives d\'apports en numéraire, qu\'elles ne sont grevées d\'aucun engagement ou nantissement, et que rien ne s\'oppose à leur libre disposition.')
         .moveDown(1);

      // Article 7 - Formalités - Pouvoirs (NOUVEAU)
      doc.fontSize(12)
         .font('Helvetica-Bold')
         .text('Article 7 - Formalités - Pouvoirs')
         .moveDown(0.3);

      doc.fontSize(11)
         .font('Helvetica')
         .text('Tous pouvoirs sont conférés au porteur des originaux ou copies des présentes en vue de procéder à l\'accomplissement de toutes formalités légales de publicité.')
         .moveDown(1);

      // Article 8 - Frais - Droits - Honoraires (NOUVEAU)
      doc.fontSize(12)
         .font('Helvetica-Bold')
         .text('Article 8 - Frais - Droits - Honoraires')
         .moveDown(0.3);

      doc.fontSize(11)
         .font('Helvetica')
         .text('Les frais, droits et honoraires de la présente cession et tous les frais qui en seront la suite ou la conséquence seront supportés par le cessionnaire, qui s\'y oblige.')
         .moveDown(1);

      // Article 9 - Règlement de différends (NOUVEAU)
      doc.fontSize(12)
         .font('Helvetica-Bold')
         .text('Article 9 - Règlement de différends')
         .moveDown(0.3);

      doc.fontSize(11)
         .font('Helvetica')
         .text('Tout litige relatif à la présente cession sera soumis au Tribunal de Commerce Hors Classe de Dakar, à défaut d\'un règlement à l\'amiable entre les parties soussignées.')
         .moveDown(1.5);

      // Lieu et date
      const dateSignature = new Date().toLocaleDateString('fr-FR');
      doc.font('Helvetica-Bold')
         .text(`Fait à Dakar, le ${dateSignature}`)
         .moveDown(1.5);

      // === SECTION SIGNATURES AMÉLIORÉE ===
      doc.font('Helvetica')
         .text('Signatures :')
         .moveDown(1);

      // Zone signature du cédant
      doc.text('LA SOCIÉTÉ DIOKO GROUP SAS :')
         .moveDown(0.3);
      
      doc.text('Monsieur Ibrahima Diakhaté')
         .text('Directeur Général')
         .moveDown(0.5);

      // === GESTION DE LA SIGNATURE ===
      const signaturePath = path.join(__dirname, '../assets/CACHET DIOKO.png');
      let signatureAdded = false;
      
      try {
        // Vérifier plusieurs formats possibles
        const possibleSignaturePaths = [
          path.join(__dirname, '../assets/CACHET DIOKO.png'),
          path.join(__dirname, '../assets/signature_dg.jpg'),
          path.join(__dirname, '../assets/signature_dg.jpeg'),
          path.join(__dirname, '../assets/signature.png'),
          path.join(__dirname, '../assets/signature.jpg')
        ];
        
        for (const sigPath of possibleSignaturePaths) {
          if (fs.existsSync(sigPath)) {
            const stats = fs.statSync(sigPath);
            if (stats.isFile() && stats.size > 0) {
              // Ajouter la signature avec dimensions contrôlées
              doc.image(sigPath, doc.x, doc.y, { 
                width: 120,
                height: 60,
                fit: [120, 60],
                align: 'left'
              });
              signatureAdded = true;
              doc.moveDown(4); // Plus d'espace après la signature
              break;
            }
          }
        }
      } catch (signatureError) {
        console.warn('Erreur lors du chargement de la signature:', signatureError.message);
      }
      
      if (!signatureAdded) {
        console.log('Signature non trouvée, ajout d\'une ligne de signature');
        doc.text('_____________________________')
           .moveDown(2); // Plus d'espace si pas de signature
      }

      // Ajouter un espace supplémentaire avant la section bénéficiaire
      doc.moveDown(1.5);

      // Zone signature du cessionnaire
      doc.text('Le Cessionnaire :')
         .moveDown(0.3);
      
      doc.text(`${fullName}`)
         .moveDown(1.5)
         .text('_____________________________');

      // Finaliser le document
      doc.end();

    } catch (error) {
      console.error('Erreur lors de la génération du PDF:', error);
      reject(error);
    }
  });
};
const generateContractBetweenUserPDF = async (purchaseData, userData, vendeurData = null) => {
  return new Promise((resolve, reject) => {
    try {
      // Créer un nouveau document PDF
      const doc = new PDFDocument({
        size: 'A4',
        margins: {
          top: 60,
          bottom: 60,
          left: 60,
          right: 60
        }
      });

      // Buffer pour stocker le PDF
      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(buffers);
        resolve(pdfBuffer);
      });

      // === GESTION DU LOGO ===
      const logoPath = path.join(__dirname, '../assets/logo.jpeg');
      let logoAdded = false;
      
      try {
        if (fs.existsSync(logoPath)) {
          const stats = fs.statSync(logoPath);
          if (stats.isFile() && stats.size > 0) {
            const logoWidth = 80;
            const logoHeight = 80;
            const pageWidth = doc.page.width;
            const logoX = (pageWidth - logoWidth) / 2;
            
            doc.image(logoPath, logoX, 45, { 
              width: logoWidth,
              height: logoHeight,
              fit: [logoWidth, logoHeight],
              align: 'center'
            });
            logoAdded = true;
            doc.moveDown(5);
          }
        }
      } catch (logoError) {
        console.warn('Erreur lors du chargement du logo:', logoError.message);
      }
      
      if (!logoAdded) {
        console.log('Logo non trouvé, création d\'un logo texte');
        doc.fontSize(20)
           .font('Helvetica-Bold')
           .fillColor('#2196F3')
           .text('DIOKO', { align: 'center' })
           .fillColor('black')
           .moveDown(2);
      }

      // === TITRE PRINCIPAL ===
      doc.fontSize(14)
         .font('Helvetica-Bold')
         .text('CONVENTION DE CESSION D\'ACTIONS', { align: 'center' })
         .moveDown(2);

      // === ENTRE LES SOUSSIGNÉS ===
      doc.fontSize(11)
         .font('Helvetica-Bold')
         .text('Entre les soussignés :', { align: 'left' })
         .moveDown(1);

      // ===== PARTIE 1 : LE CÉDANT (VENDEUR) =====
      const nomCompletVendeur = vendeurData?.nom_complet || 
                                `${vendeurData?.firstName || ''} ${vendeurData?.lastName || ''}`.trim() || 
                                'Ibrahima Diakhaté';
      const nationaliteVendeur = vendeurData?.nationalite || 'sénégalaise';
      const villeVendeur = vendeurData?.ville || 'Dakar';
      const paysVendeur = vendeurData?.pays || 'Sénégal';
      const adresseVendeur = vendeurData?.adresse || `${villeVendeur} -- ${paysVendeur}`;
      const carteIdentiteVendeur = vendeurData?.carte_identite || '[NUMÉRO]';
      const villeCarteVendeur = vendeurData?.ville_carte || villeVendeur;

      doc.font('Helvetica-Bold')
         .text(`M. ${nomCompletVendeur}`, { continued: true })
         .font('Helvetica')
         .text(',');
      
      doc.text(`De nationalité ${nationaliteVendeur}, demeurant à ${adresseVendeur},`);
      doc.text(`Titulaire de la carte d'identité n° ${carteIdentiteVendeur} délivrée à ${villeCarteVendeur},`);
      doc.text('Ci-après dénommé ', { continued: true })
         .font('Helvetica-Bold')
         .text('le cédant', { continued: true })
         .font('Helvetica')
         .text(',');
      
      doc.text('D\'une part :')
         .moveDown(1);

      // === ET ===
      doc.font('Helvetica-Bold')
         .text('Et', { align: 'center' })
         .moveDown(1);

      // ===== PARTIE 2 : LE CESSIONNAIRE (ACHETEUR) =====
      const nomCompletAcheteur = userData?.nom_complet ||
                                 `${userData?.firstName || ''} ${userData?.lastName || ''}`.trim() || 
                                 '[NOM DU BÉNÉFICIAIRE]';
      const nationaliteAcheteur = userData?.nationalite || 'sénégalaise';
      const villeAcheteur = userData?.ville || 'Dakar';
      const paysAcheteur = userData?.pays || 'Sénégal';
      const adresseAcheteur = userData?.adresse || `${villeAcheteur} -- ${paysAcheteur}`;
      const carteIdentiteAcheteur = userData?.carte_identite || '[NUMÉRO]';
      const villeCarteAcheteur = userData?.ville_carte || villeAcheteur;

      doc.font('Helvetica-Bold')
         .text(`M. ${nomCompletAcheteur}`, { continued: true })
         .font('Helvetica')
         .text(',');
      
      doc.text(`De nationalité ${nationaliteAcheteur}, demeurant à ${adresseAcheteur},`);
      doc.text(`Titulaire de la carte d'identité n° ${carteIdentiteAcheteur} délivrée à ${villeCarteAcheteur},`);
      doc.text('Ci-après dénommé ', { continued: true })
         .font('Helvetica-Bold')
         .text('le cessionnaire', { continued: true })
         .font('Helvetica')
         .text(',');
      
      doc.text('D\'autre part :')
         .moveDown(2);

      // === PRÉAMBULE ===
      doc.fontSize(12)
         .font('Helvetica-Bold')
         .text('PRÉAMBULE')
         .moveDown(0.5);

      doc.fontSize(11)
         .font('Helvetica')
         .text('Il est exposé ce qui suit :')
         .moveDown(0.5);

      // Récupération des données du vendeur (AVANT la vente)
      const nombreActionsVendeur = vendeurData?.nbre_actions || 0;
      const pourcentageVendeur = ((nombreActionsVendeur / 1000000) * 100).toFixed(5);

      doc.text('Que ', { continued: true })
         .font('Helvetica-Bold')
         .text(`${nomCompletVendeur}`, { continued: true })
         .font('Helvetica')
         .text(' est actionnaire de la Société ', { continued: true })
         .font('Helvetica-Bold')
         .text('DIOKO GROUP SAS', { continued: true })
         .font('Helvetica')
         .text(', Société Anonyme au capital de ', { continued: true })
         .font('Helvetica-Bold')
         .text('1 000 000 FCFA', { continued: true })
         .font('Helvetica')
         .text(', ayant son siège social à ', { continued: true })
         .font('Helvetica-Bold')
         .text('Sacré-Cœur 03 TF 21 926 / DG LOT N°137, Dakar -- Sénégal', { continued: true })
         .font('Helvetica')
         .text(', immatriculée au Registre du Commerce et du Crédit Mobilier (RCCM) sous le numéro ', { continued: true })
         .font('Helvetica-Bold')
         .text('SN.DKR.2023.B.52045', { continued: true })
         .font('Helvetica')
         .text('.');
      
      doc.moveDown(0.5);

      doc.text('Le cédant possède ', { continued: true })
         .font('Helvetica-Bold')
         .text(`${nombreActionsVendeur.toLocaleString('fr-FR')}`, { continued: true })
         .font('Helvetica')
         .text(' actions de la société, soit ', { continued: true })
         .font('Helvetica-Bold')
         .text(`${pourcentageVendeur}%`, { continued: true })
         .font('Helvetica')
         .text(' de participation dans le capital. Le cédant certifie qu\'il est valablement et pleinement propriétaire de ses titres dans ladite société, qu\'il a tous pouvoirs pour les céder et que ces titres sont libres de tout nantissement ou de toute sûreté.')
         .moveDown(1.5);

      // === ARTICLE 1 ===
      doc.fontSize(12)
         .font('Helvetica-Bold')
         .text('Article 1 -- Société concernée')
         .moveDown(0.3);

      doc.fontSize(11)
         .font('Helvetica')
         .text('Le présent contrat concerne la société ', { continued: true })
         .font('Helvetica-Bold')
         .text('DIOKO GROUP SAS', { continued: true })
         .font('Helvetica')
         .text(', société par actions simplifiée au capital de ', { continued: true })
         .font('Helvetica-Bold')
         .text('1 000 000 FCFA', { continued: true })
         .font('Helvetica')
         .text(', dont le siège social est situé à ', { continued: true })
         .font('Helvetica-Bold')
         .text('Sacré-Cœur 03 TF 21 926 / DG LOT N°137, Dakar -- Sénégal', { continued: true })
         .font('Helvetica')
         .text(', immatriculée au Registre du Commerce et des Sociétés de Dakar sous le numéro ', { continued: true })
         .font('Helvetica-Bold')
         .text('010840446', { continued: true })
         .font('Helvetica')
         .text(' - RC : ', { continued: true })
         .font('Helvetica-Bold')
         .text('SN.DKR.2023.B.52045', { continued: true })
         .font('Helvetica')
         .text(', représentée par ', { continued: true })
         .font('Helvetica-Bold')
         .text('Monsieur Ibrahima Diakhaté', { continued: true })
         .font('Helvetica')
         .text(', en sa qualité de ', { continued: true })
         .font('Helvetica-Bold')
         .text('Directeur Général', { continued: true })
         .font('Helvetica')
         .text('.')
         .moveDown(1);

      // === ARTICLE 2 - CESSION ===
      const nombreActionsAchat = Number(purchaseData?.nombre_actions || purchaseData?.nbre_actions || 0);
      const pourcentageAchat = ((nombreActionsAchat / 1000000) * 100).toFixed(5);

      doc.fontSize(12)
         .font('Helvetica-Bold')
         .text('Article 2 -- Cession')
         .moveDown(0.3);

      doc.fontSize(11)
         .font('Helvetica')
         .text('Monsieur ', { continued: true })
         .font('Helvetica-Bold')
         .text(`${nomCompletVendeur}`, { continued: true })
         .font('Helvetica')
         .text(' cède et transporte par les présentes, sous les garanties ordinaires de fait et de droit, à Monsieur ', { continued: true })
         .font('Helvetica-Bold')
         .text(`${nomCompletAcheteur}`, { continued: true })
         .font('Helvetica')
         .text(' qui accepte, ', { continued: true })
         .font('Helvetica-Bold')
         .text(`${nombreActionsAchat.toLocaleString('fr-FR')}`, { continued: true })
         .font('Helvetica')
         .text(' actions lui appartenant dans la société ', { continued: true })
         .font('Helvetica-Bold')
         .text('DIOKO GROUP SAS', { continued: true })
         .font('Helvetica')
         .text(', soit ', { continued: true })
         .font('Helvetica-Bold')
         .text(`${pourcentageAchat}%`, { continued: true })
         .font('Helvetica')
         .text(' du capital de ladite société.')
         .moveDown(1);

      // === ARTICLE 3 - PAIEMENT ===
      const prixParAction = purchaseData?.price_per_share || purchaseData?.prix_unitaire || 0;
      const montantTotal = purchaseData?.montant || purchaseData?.montant_total || (nombreActionsAchat * prixParAction);

      // Fonction pour formater les nombres avec espaces comme séparateurs de milliers
      const formatPrice = (number) => {
        return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
      };

      doc.fontSize(12)
         .font('Helvetica-Bold')
         .text('Article 3 -- Paiement')
         .moveDown(0.3);

      doc.fontSize(11)
         .font('Helvetica')
         .text('La présente cession est consentie et acceptée moyennant le prix de ', { continued: true })
         .font('Helvetica-Bold')
         .text(`${formatPrice(prixParAction)} Francs CFA`, { continued: true })
         .font('Helvetica')
         .text(' par action cédée, soit un prix total de ', { continued: true })
         .font('Helvetica-Bold')
         .text(`${formatPrice(montantTotal)} Francs CFA`, { continued: true })
         .font('Helvetica')
         .text(', ce que le Cédant reconnaît et accepte sans réserve.')
         .moveDown(1);

      // === ARTICLE 4 - EFFET DE LA CESSION ===
      doc.fontSize(12)
         .font('Helvetica-Bold')
         .text('Article 4 -- Effet de la cession')
         .moveDown(0.3);

      doc.fontSize(11)
         .font('Helvetica')
         .text('Le transfert de propriété prend effet à la date de signature du présent contrat. Le cessionnaire sera propriétaire et aura la jouissance des actions cédées à compter de la signature des présentes et sera subrogé dans tous ses droits et obligations attachés aux dites actions.')
         .moveDown(1);

      // === ARTICLE 5 - SIGNIFICATION ===
      doc.fontSize(12)
         .font('Helvetica-Bold')
         .text('Article 5 : Signification')
         .moveDown(0.3);

      doc.fontSize(11)
         .font('Helvetica')
         .text('La présente cession fera l\'objet d\'un bordereau de transfert signé du cédant et sera notifiée à la société par dépôt au siège social, contre remise par la direction générale d\'une attestation de dépôt, conformément à l\'article 763-1 de l\'Acte uniforme sur le droit des sociétés commerciales et du GIE.')
         .moveDown(1);

      // === ARTICLE 6 - DÉCLARATION FISCALE ===
      doc.fontSize(12)
         .font('Helvetica-Bold')
         .text('Article 6 : Declaration Fiscale')
         .moveDown(0.3);

      doc.fontSize(11)
         .font('Helvetica')
         .text('Pour la liquidation des droits d\'enregistrement, le cédant déclare que les actions cédées sont représentatives d\'apports en numéraire, qu\'elles ne sont grevées d\'aucun engagement ou nantissement, et que rien ne s\'oppose à leur libre disposition.')
         .moveDown(1);

      // === ARTICLE 7 - FORMALITÉS ===
      doc.fontSize(12)
         .font('Helvetica-Bold')
         .text('Article 7 : Formalités - Pouvoirs')
         .moveDown(0.3);

      doc.fontSize(11)
         .font('Helvetica')
         .text('Tous pouvoirs sont conférés au porteur des originaux ou copies des présentes en vue de procéder à l\'accomplissement de toutes formalités légales de publicité.')
         .moveDown(1);

      // === ARTICLE 8 - FRAIS ===
      doc.fontSize(12)
         .font('Helvetica-Bold')
         .text('Article 8 : Frais - Droits - Honoraires')
         .moveDown(0.3);

      doc.fontSize(11)
         .font('Helvetica')
         .text('Les frais, droits et honoraires de la présente cession et tous les frais qui en seront la suite ou la conséquence seront supportés par le cessionnaire, qui s\'y oblige.')
         .moveDown(1);

      // === ARTICLE 9 - RÈGLEMENT DE DIFFÉRENDS ===
      doc.fontSize(12)
         .font('Helvetica-Bold')
         .text('Article 9 : Règlements de différends')
         .moveDown(0.3);

      doc.fontSize(11)
         .font('Helvetica')
         .text('Tout litige relatif à la présente cession sera soumis au ', { continued: true })
         .font('Helvetica-Bold')
         .text('Tribunal de Commerce Hors Classe de Dakar', { continued: true })
         .font('Helvetica')
         .text(', à défaut d\'un règlement à l\'amiable entre les parties soussignées.')
         .moveDown(2);

      // === DATE ET LIEU ===
      const dateSignature = new Date().toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });

      doc.font('Helvetica-Bold')
         .text(`Fait à Dakar, le ${dateSignature}`)
         .moveDown(2);

      // === SIGNATURES ===
      doc.fontSize(11)
         .font('Helvetica')
         .text('Signatures :')
         .moveDown(2);

      // Signature DIOKO GROUP
      doc.font('Helvetica-Bold')
         .text('DIOKOGROUP :')
         .moveDown(0.5);

      // Gestion du cachet/signature
      const cachetPath = path.join(__dirname, '../assets/CACHET DIOKO.png');
      let cachetAdded = false;
      
      try {
        if (fs.existsSync(cachetPath)) {
          const stats = fs.statSync(cachetPath);
          if (stats.isFile() && stats.size > 0) {
            doc.image(cachetPath, doc.x, doc.y, { 
              width: 100,
              height: 50,
              fit: [100, 50]
            });
            cachetAdded = true;
            doc.moveDown(4);
          }
        }
      } catch (err) {
        console.warn('Cachet non trouvé');
      }

      if (!cachetAdded) {
        doc.font('Helvetica')
           .text('___________________________')
           .moveDown(3);
      }

      // Signature du cédant (VENDEUR)
      doc.font('Helvetica-Bold')
         .text(`Le Cédant :`)
         .moveDown(0.3);
      
      doc.font('Helvetica')
         .text(`${nomCompletVendeur}`)
         .moveDown(0.5)
         .text('___________________________')
         .moveDown(3);

      // Signature du bénéficiaire (ACHETEUR)
      doc.font('Helvetica-Bold')
         .text(`Le BÉNÉFICIAIRE :`)
         .moveDown(0.3);
      
      doc.font('Helvetica')
         .text(`${nomCompletAcheteur}`)
         .moveDown(0.5)
         .text('___________________________');

      // Finaliser le document
      doc.end();

    } catch (error) {
      console.error('Erreur lors de la génération du PDF:', error);
      reject(error);
    }
  });
};
module.exports = {
  generateContractPDF,generateContractBetweenUserPDF
};