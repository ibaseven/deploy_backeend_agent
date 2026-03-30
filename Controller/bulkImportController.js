// controllers/bulkImportController.js
const multer = require('multer');
const pdf = require('pdf-parse');
const csv = require('csv-parse/sync');
const XLSX = require('xlsx');
const bcrypt = require('bcrypt');
const User = require('../Models/User');
const Entreprise = require('../Models/Entreprise');
const qs = require("qs");
const axios = require("axios");
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Type de fichier non supporté. Utilisez PDF, CSV ou Excel.'));
    }
  }
});
const INSTANCE_ID = process.env.ULTRAMSG_INSTANCE_ID;
const TOKEN = process.env.ULTRAMSG_TOKEN;
// Fonction pour générer un mot de passe aléatoire
const generateRandomPassword = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let password = '';
  for (let i = 0; i < 8; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
};

// Fonction pour calculer le dividende
const calculateDividende = async (nbre_actions) => {
  try {
    const entreprise = await Entreprise.findOne().sort({ annee: -1 });
    if (!entreprise) return 0;
    return (entreprise.total_benefice * nbre_actions) / 100000;
  } catch (error) {
    console.error('Erreur calcul dividende:', error);
    return 0;
  }
};
function formatPhoneNumber(telephone) {
  // Supprimer tous les caractères non numériques
  let cleaned = telephone.replace(/\D/g, '');
  
  // Validation de base - s'assurer que ce n'est pas vide
  if (!cleaned) {
    throw new Error('Numéro de téléphone invalide');
  }
  
  // Validation de longueur raisonnable (entre 8 et 15 chiffres)
  if (cleaned.length < 8 || cleaned.length > 15) {
    throw new Error('Longueur du numéro de téléphone invalide');
  }
  
  // Retourner le numéro nettoyé sans modification automatique
  return cleaned;
}
async function sendWhatsAppMessage(phoneNumber, message) {
  const INSTANCE_ID = process.env.ULTRAMSG_INSTANCE_ID;
  const TOKEN = process.env.ULTRAMSG_TOKEN;
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


// Fonction améliorée pour traiter un PDF avec extraction depuis buffer si nécessaire
// Fonction pour détecter le pays d'un numéro de téléphone
const detectPhoneCountry = (phoneNumber) => {
  const cleanNumber = phoneNumber.replace(/\D/g, ''); // Enlever tous les non-chiffres
  
  // Sénégal - préfixes 7 (77, 78, 76, 75, 70) avec 9 chiffres
  if (cleanNumber.length === 9 && cleanNumber.startsWith('7')) {
    const prefix = cleanNumber.substring(0, 2);
    if (['77', '78', '76', '75', '70'].includes(prefix)) {
      return 'SN'; // Sénégal
    }
  }
  
  // Côte d'Ivoire - préfixes divers avec 8 ou 10 chiffres
  if (cleanNumber.length === 8 || cleanNumber.length === 10) {
    const prefix2 = cleanNumber.substring(0, 2);
    const prefix3 = cleanNumber.substring(0, 3);
    
    // Préfixes Côte d'Ivoire
    const ivoirePrefixes2 = ['07', '05', '01', '02', '03', '04', '06', '08', '09'];
    const ivoirePrefixes3 = ['225']; // Code pays
    
    if (ivoirePrefixes2.includes(prefix2) || ivoirePrefixes3.includes(prefix3)) {
      return 'CI'; // Côte d'Ivoire
    }
  }
  
  // Numéros internationaux avec indicatif
  if (cleanNumber.length === 12 && cleanNumber.startsWith('221')) {
    return 'SN'; // Sénégal (+221)
  }
  if (cleanNumber.length === 11 && cleanNumber.startsWith('225')) {
    return 'CI'; // Côte d'Ivoire (+225)
  }
  
  // Patterns spéciaux détectés dans vos données
  if (cleanNumber.length === 10 && cleanNumber.startsWith('3')) {
    return 'CI'; // Probablement Côte d'Ivoire
  }
  
  return 'UNKNOWN';
};

// Fonction pour nettoyer le numéro selon le pays
const cleanPhoneByCountry = (phoneNumber, country) => {
  let cleanPhone = phoneNumber.replace(/\s/g, '');
  
  switch(country) {
    case 'SN': // Sénégal
      // Enlever l'indicatif +221 s'il est présent
      if (cleanPhone.startsWith('+221')) {
        cleanPhone = cleanPhone.substring(4);
      } else if (cleanPhone.startsWith('221')) {
        cleanPhone = cleanPhone.substring(3);
      }
      // Garder les 9 chiffres du numéro local
      cleanPhone = cleanPhone.replace(/[^\d]/g, '');
      break;
      
    case 'CI': // Côte d'Ivoire
      // Enlever l'indicatif +225 s'il est présent
      if (cleanPhone.startsWith('+225')) {
        cleanPhone = cleanPhone.substring(4);
      } else if (cleanPhone.startsWith('225')) {
        cleanPhone = cleanPhone.substring(3);
      }
      // Garder le numéro local (8 chiffres généralement)
      cleanPhone = cleanPhone.replace(/[^\d]/g, '');
      break;
      
    default:
      cleanPhone = cleanPhone.replace(/[^\d]/g, '');
  }
  
  return cleanPhone;
};

const parsePDFData = async (buffer) => {
  try {
    // Méthode 1: pdf-parse standard
    let data = await pdf(buffer);
    let text = data.text;
    
    //('=== EXTRACTION PDF ===');
    //('Longueur du texte extrait:', text.length);
    //('Premiers 500 caractères:', text.substring(0, 500));
    
    // Si le texte extrait est trop court (PDF image), extraire du buffer
    if (!text || text.trim().length < 50) {
      //('Texte trop court, extraction depuis le buffer...');
      
      const bufferString = buffer.toString('utf8');
      
      // Patterns améliorés pour supporter les numéros des deux pays
      const patterns = [
        // Pattern pour numéros sénégalais (9 chiffres commençant par 7)
        /(\d+)[\s\x00-\x1F]*([A-Za-zÀ-ÿ\s]+?)[\s\x00-\x1F]*(7[0-8]\d{7})[\s\x00-\x1F]*([\d\.]+)/g,
        // Pattern pour numéros ivoiriens courts (8 chiffres commençant par 0)
        /(\d+)[\s\x00-\x1F]*([A-Za-zÀ-ÿ\s]+?)[\s\x00-\x1F]*(0[1-9]\d{6,7})[\s\x00-\x1F]*([\d\.]+)/g,
        // Pattern pour numéros ivoiriens avec indicatif (225XXXXXXXX)
        /(\d+)[\s\x00-\x1F]*([A-Za-zÀ-ÿ\s]+?)[\s\x00-\x1F]*(225\d{8})[\s\x00-\x1F]*([\d\.]+)/g,
        // Pattern pour numéros longs divers (10-12 chiffres)
        /(\d+)[\s\x00-\x1F]*([A-Za-zÀ-ÿ\s]+?)[\s\x00-\x1F]*(\d{10,12})[\s\x00-\x1F]*([\d\.]+)/g,
        // Pattern général (8-12 chiffres)
        /(\d+)[\s\x00-\x1F]*([A-Za-zÀ-ÿ\s]+?)[\s\x00-\x1F]*(\d{8,12})[\s\x00-\x1F]*([\d\.]+)/g,
        // Pattern alternatif avec caractères de contrôle
        /(\d+)[^\w]*([A-Za-zÀ-ÿ\s]+?)[^\w]*(\d{8,12})[^\w]*([\d\.]+)/g,
        // Pattern très permissif
        /(\d+).*?([A-Za-zÀ-ÿ]{3,}.*?).*?(\d{8,12}).*?([\d\.]+)/g
      ];
      
      let extractedLines = [];
      
      patterns.forEach((pattern, patternIndex) => {
        //(`Essai du pattern ${patternIndex}...`);
        const matches = [...bufferString.matchAll(pattern)];
        
        if (matches.length > 0) {
          //(`Pattern ${patternIndex} trouvé ${matches.length} correspondances`);
          
          matches.forEach((match, matchIndex) => {
            if (match.length >= 5) {
              const [fullMatch, numero, nom, telephone, actions] = match;
              
              // Détecter le pays du numéro
              const country = detectPhoneCountry(telephone);
              
              // Nettoyer les données extraites
              const numeroClean = numero.trim();
              const nomClean = nom.replace(/[\x00-\x1F\x7F]/g, ' ').trim().replace(/\s+/g, ' ');
              const telephoneClean = cleanPhoneByCountry(telephone, country);
              const actionsClean = actions.trim();
              
              // Valider que les données semblent correctes
              if (nomClean.length > 2 && telephoneClean.length >= 8 && !isNaN(parseFloat(actionsClean))) {
                extractedLines.push(`${numeroClean} ${nomClean} ${telephoneClean} ${actionsClean} ${country}`);
                (`Match ${matchIndex + 1}:`, {
                  numero: numeroClean,
                  nom: nomClean,
                  telephone: telephoneClean,
                  actions: actionsClean,
                  pays: country === 'SN' ? 'Sénégal' : country === 'CI' ? 'Côte d\'Ivoire' : 'Indéterminé'
                });
              }
            }
          });
          
          // Si on a trouvé des données avec ce pattern, on s'arrête
          if (extractedLines.length > 0) {
            //(`Pattern ${patternIndex} utilisé avec ${extractedLines.length} lignes extraites`);
            text = extractedLines.join('\n');
            return;
          }
        }
      });
      
      if (extractedLines.length === 0) {
        // Dernier recours : recherche manuelle de téléphones et reconstruction
        //('Dernière tentative : recherche de téléphones...');
        const phonePatterns = [
          /7[0-8]\d{7}/g,    // Sénégal
          /0[1-9]\d{6,7}/g,  // Côte d'Ivoire (format court)
          /225\d{8}/g,       // Côte d'Ivoire (avec indicatif)
          /\d{8,12}/g        // Général
        ];
        
        let phoneMatches = [];
        phonePatterns.forEach(pattern => {
          const matches = bufferString.match(pattern) || [];
          phoneMatches = phoneMatches.concat(matches);
        });
        
        if (phoneMatches && phoneMatches.length > 0) {
          //(`${phoneMatches.length} numéros de téléphone trouvés:`, phoneMatches.slice(0, 5));
          
          // Essayer de reconstruire des lignes autour des téléphones
          phoneMatches.forEach((phone, index) => {
            const phoneIndex = bufferString.indexOf(phone);
            if (phoneIndex > -1) {
              // Extraire un contexte autour du téléphone
              const start = Math.max(0, phoneIndex - 50);
              const end = Math.min(bufferString.length, phoneIndex + phone.length + 20);
              const context = bufferString.substring(start, end);
              
              // Essayer d'extraire numéro, nom et actions du contexte
              const contextMatch = context.match(/(\d+)[^\w]*([A-Za-zÀ-ÿ\s]+?)[^\w]*(\d{8,12})[^\w]*([\d\.]+)/);
              if (contextMatch) {
                const country = detectPhoneCountry(contextMatch[3]);
                const cleanPhone = cleanPhoneByCountry(contextMatch[3], country);
                extractedLines.push(`${contextMatch[1]} ${contextMatch[2]} ${cleanPhone} ${contextMatch[4]} ${country}`);
              }
            }
          });
          
          if (extractedLines.length > 0) {
            text = extractedLines.join('\n');
          }
        }
      }
    }
    
    if (!text || text.trim().length < 10) {
      throw new Error(`PDF de type image détecté. Impossible d'extraire le texte automatiquement.
      
Solutions recommandées:
1. Convertir le PDF en Excel/CSV manuellement
2. Utiliser un outil OCR pour extraire le texte
3. Saisir les données via l'API JSON

Données détectées dans le buffer: ${buffer.toString('utf8').includes('ACTIONNAIRE') ? 'Oui' : 'Non'}
Numéros trouvés: ${(buffer.toString('utf8').match(/\d{8,12}/g) || []).length}`);
    }
    
    //('=== PARSING DES DONNÉES ===');
    //('Texte final à parser:', text.substring(0, 500));
    
    const lines = text.split('\n').filter(line => line.trim());
    const actionnaires = [];
    
    // Patterns multiples pour différents formats avec support multi-pays
    const patterns = [
      // Pattern avec pays à la fin (ajouté par notre extraction)
      /^\s*(\d+)\s+([A-Za-zÀ-ÿ\s]+?)\s+(\d{8,12})\s+([\d\.]+)\s+(SN|CI|UNKNOWN)\s*$/,
      // Pattern sénégalais: Numéro Nom Téléphone(9 chiffres commençant par 7) Actions
      /^\s*(\d+)\s+([A-Za-zÀ-ÿ\s]+?)\s+(7[0-8]\d{7})\s+([\d\.]+)\s*$/,
      // Pattern ivoirien court: Numéro Nom Téléphone(8 chiffres commençant par 0) Actions
      /^\s*(\d+)\s+([A-Za-zÀ-ÿ\s]+?)\s+(0[1-9]\d{6,7})\s+([\d\.]+)\s*$/,
      // Pattern ivoirien avec indicatif: Numéro Nom Téléphone(225XXXXXXXX) Actions
      /^\s*(\d+)\s+([A-Za-zÀ-ÿ\s]+?)\s+(225\d{8})\s+([\d\.]+)\s*$/,
      // Pattern principal: Numéro Nom Téléphone Actions
      /^\s*(\d+)\s+([A-Za-zÀ-ÿ\s]+?)\s+(\d{8,12})\s+([\d\.]+)\s*$/,
      // Pattern alternatif avec plus d'espaces
      /^\s*(\d+)\s+(.*?)\s+(\d{8,12})\s+([\d\.]+)\s*$/,
      // Pattern pour lignes avec beaucoup d'espaces
      /(\d+)\s+([^0-9]+?)\s+(\d{8,12})\s+([\d\.]+)/,
      // Pattern très permissif
      /(\d+)[\s\t]+([A-Za-zÀ-ÿ\s]+?)[\s\t]+(\d{8,12})[\s\t]+([\d\.]+)/
    ];
    
    // Statistiques par pays
    const countryStats = { SN: 0, CI: 0, UNKNOWN: 0 };
    
    lines.forEach((line, index) => {
      line = line.trim();
      
      // Ignorer les lignes vides, en-têtes et séparateurs
      if (!line || 
          line.includes('─') || 
          line.includes('═') || 
          (line.includes('ACTIONNAIRE') && line.includes('Téléphone')) ||
          line.length < 10) {
        return;
      }
      
      //(`Ligne ${index + 1}: "${line}"`);
      
      let match = null;
      let patternUsed = -1;
      let detectedCountry = null;
      
      // Essayer chaque pattern
      for (let i = 0; i < patterns.length; i++) {
        match = line.match(patterns[i]);
        if (match && match.length >= 5) {
          patternUsed = i;
          // Si le pattern inclut le pays (pattern 0), l'extraire
          if (i === 0 && match[5]) {
            detectedCountry = match[5];
          }
          break;
        }
      }
      
      if (match && match.length >= 5) {
        const [, numero, nomComplet, telephone, actions] = match;
        
        // Détecter le pays si pas déjà fait
        if (!detectedCountry) {
          detectedCountry = detectPhoneCountry(telephone);
        }
        
     /*    (`  ✅ Parsé avec pattern ${patternUsed}:`, {
          numero, 
          nomComplet, 
          telephone, 
          actions, 
          pays: detectedCountry === 'SN' ? 'Sénégal' : detectedCountry === 'CI' ? 'Côte d\'Ivoire' : 'Indéterminé'
        });
         */
        // Traiter le nom complet
        const nomCompletClean = nomComplet.trim().replace(/\s+/g, ' ');
        const nomParts = nomCompletClean.split(/\s+/);
        
        let firstName = '';
        let lastName = '';
        
        if (nomParts.length === 1) {
          firstName = nomParts[0];
          lastName = nomParts[0];
        } else if (nomParts.length >= 2) {
          firstName = nomParts[0];
          lastName = nomParts.slice(1).join(' ');
        }
        
        // Nettoyer le téléphone selon le pays détecté
        const cleanPhone = cleanPhoneByCountry(telephone, detectedCountry);
        
        const nbreActions = parseFloat(actions.replace(',', '.')) || 0;
        
        const actionnaire = {
          numero: parseInt(numero),
          firstName: firstName,
          lastName: lastName,
          telephone: cleanPhone,
          nbre_actions: nbreActions,
          pays: detectedCountry, // Ajouter le pays détecté
          ligne_originale: line,
          pattern_utilise: patternUsed
        };
        
        // Mettre à jour les statistiques
        countryStats[detectedCountry]++;
        
        actionnaires.push(actionnaire);
        //(`  ➕ Actionnaire ajouté:`, actionnaire);
        
      } else {
        //(`  ❌ Ligne non reconnue: "${line}"`);
      }
    });
    
    //(`=== RÉSULTAT FINAL ===`);
    //(`${actionnaires.length} actionnaires extraits du PDF`);
  /*   //(`Répartition par pays:`, {
      'Sénégal': countryStats.SN,
      'Côte d\'Ivoire': countryStats.CI,
      'Indéterminé': countryStats.UNKNOWN
    });
     */
    if (actionnaires.length === 0) {
      //('=== DIAGNOSTIC ===');
      //('Lignes analysées:', lines.length);
      //('Échantillon de lignes:', lines.slice(0, 10));
      
      throw new Error(`Aucun actionnaire trouvé dans ce PDF image.

SOLUTIONS RECOMMANDÉES:
1. 📊 Convertir en Excel: Ouvrir le PDF → Sélectionner tout → Copier → Coller dans Excel
2. 🔤 Utiliser un OCR en ligne pour extraire le texte
3. 📝 Saisir via l'API JSON: POST /bulk-import/json

Le PDF contient ${lines.length} lignes mais aucune ne correspond au format attendu.
Formats supportés: 
- Sénégal: "Numéro Nom 7XXXXXXXX Actions"
- Côte d'Ivoire: "Numéro Nom 0XXXXXXX Actions" ou "Numéro Nom 225XXXXXXXX Actions"`);
    }
    
    // Ajouter les statistiques comme propriété du tableau
    actionnaires.statistiques = {
      total: actionnaires.length,
      parPays: {
        senegal: countryStats.SN,
        coteIvoire: countryStats.CI,
        indetermine: countryStats.UNKNOWN
      }
    };
    
    return actionnaires;
    
  } catch (error) {
    console.error('=== ERREUR PARSING PDF ===');
    console.error('Message:', error.message);
    throw error;
  }
};

// Exporter les fonctions utilitaires
module.exports = {
  parsePDFData,
  detectPhoneCountry,
  cleanPhoneByCountry
};

// Fonction pour traiter un fichier CSV
const parseCSVData = async (buffer) => {
  try {
    const text = buffer.toString('utf8');
    const records = csv.parse(text, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
    
    return records.map(record => ({
      firstName: record.firstName || record.prenom || record.first_name,
      lastName: record.lastName || record.nom || record.last_name,
      telephone: record.telephone || record.phone || record.tel,
      nbre_actions: parseInt(record.nbre_actions || record.actions || record.shares || 0)
    }));
  } catch (error) {
    throw new Error(`Erreur parsing CSV: ${error.message}`);
  }
};

// Fonction pour traiter un fichier Excel
const parseExcelData = async (buffer) => {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet);
    
    return jsonData.map(row => ({
      firstName: row.firstName || row.prenom || row.first_name || row.Prénom,
      lastName: row.lastName || row.nom || row.last_name || row.Nom,
      telephone: row.telephone || row.phone || row.tel || row.Téléphone,
      nbre_actions: parseInt(row.nbre_actions || row.actions || row.shares || row.Actions || 0)
    }));
  } catch (error) {
    throw new Error(`Erreur parsing Excel: ${error.message}`);
  }
};

// ROUTES EXPORTS - Toutes les fonctions doivent être des fonctions simples

// Import en masse depuis un fichier
module.exports.bulkImportFromFile = async (req, res) => {
  try {
    upload.single('file')(req, res, async (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: "Erreur upload",
          error: err.message
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Aucun fichier fourni"
        });
      }

      //(`Traitement du fichier: ${req.file.originalname}, Type: ${req.file.mimetype}`);

      let actionnaires = [];

      try {
        // Parser selon le type de fichier
        if (req.file.mimetype === 'application/pdf') {
          actionnaires = await parsePDFData(req.file.buffer);
        } else if (req.file.mimetype === 'text/csv') {
          actionnaires = await parseCSVData(req.file.buffer);
        } else if (req.file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
          actionnaires = await parseExcelData(req.file.buffer);
        }

        if (actionnaires.length === 0) {
          return res.status(400).json({
            success: false,
            message: "Aucun actionnaire trouvé dans le fichier"
          });
        }

        //(`${actionnaires.length} actionnaires trouvés dans le fichier`);

        // Afficher les statistiques par pays si disponibles
        if (actionnaires.statistiques) {
          //('=== STATISTIQUES PAR PAYS ===');
          //(`🇸🇳 Sénégal: ${actionnaires.statistiques.parPays.senegal}`);
          //(`🇨🇮 Côte d'Ivoire: ${actionnaires.statistiques.parPays.coteIvoire}`);
          //(`❓ Indéterminés: ${actionnaires.statistiques.parPays.indetermine}`);
        }

        // Vérifier qu'une entreprise existe
        const entreprise = await Entreprise.findOne().sort({ annee: -1 });
        if (!entreprise) {
          return res.status(400).json({
            success: false,
            message: "Aucune entreprise trouvée. Créez d'abord une entreprise."
          });
        }

        const results = {
          total: actionnaires.length,
          success: 0,
          errors: [],
          created: [],
          // Ajouter les statistiques par pays
          statistiques: {
            total: actionnaires.length,
            parPays: {
              senegal: 0,
              coteIvoire: 0,
              indetermine: 0
            }
          }
        };

        // Traitement par lots de 5 pour éviter de surcharger
        const batchSize = 5;
        for (let i = 0; i < actionnaires.length; i += batchSize) {
          const batch = actionnaires.slice(i, i + batchSize);
          
          await Promise.all(batch.map(async (actionnaireData, index) => {
            try {
              const { firstName, lastName, telephone, nbre_actions, pays } = actionnaireData;

              // Validation des données
              if (!firstName || !lastName || !telephone) {
                results.errors.push({
                  ligne: i + index + 1,
                  donnees: actionnaireData,
                  erreur: "Données manquantes (firstName, lastName ou telephone)"
                });
                return;
              }

              // Déterminer le pays et l'indicatif téléphonique
              let paysDetecte = pays || 'UNKNOWN';
              let telephoneAvecIndicatif = telephone;
              let messageLangue = 'fr'; // français par défaut

              // Ajouter l'indicatif selon le pays
              if (paysDetecte === 'SN') {
                // Sénégal
                if (!telephone.startsWith('+221') && !telephone.startsWith('221')) {
                  telephoneAvecIndicatif = `+221${telephone}`;
                }
                results.statistiques.parPays.senegal++;
                messageLangue = 'fr';
              } else if (paysDetecte === 'CI') {
                // Côte d'Ivoire
                if (!telephone.startsWith('+225') && !telephone.startsWith('225')) {
                  telephoneAvecIndicatif = `+225${telephone}`;
                }
                results.statistiques.parPays.coteIvoire++;
                messageLangue = 'fr';
              } else {
                // Pays indéterminé - essayer de détecter par le format du numéro
                if (telephone.length === 9 && telephone.startsWith('7')) {
                  telephoneAvecIndicatif = `+221${telephone}`;
                  paysDetecte = 'SN';
                  results.statistiques.parPays.senegal++;
                } else if (telephone.length === 8 && telephone.startsWith('0')) {
                  telephoneAvecIndicatif = `+225${telephone}`;
                  paysDetecte = 'CI';
                  results.statistiques.parPays.coteIvoire++;
                } else {
                  results.statistiques.parPays.indetermine++;
                }
              }

              // Vérifier si l'utilisateur existe déjà (avec les deux formats de téléphone)
              const existingUser = await User.findOne({ 
                $or: [
                  { telephone: telephone },
                  { telephone: telephoneAvecIndicatif }
                ]
              });
              
              if (existingUser) {
                results.errors.push({
                  ligne: i + index + 1,
                  donnees: actionnaireData,
                  erreur: "Utilisateur déjà existant"
                });
                return;
              }

              // Générer mot de passe et calculer dividendes
              const password = generateRandomPassword();
              const hashedPassword = await bcrypt.hash(password, 10);
              
              // Calculer le dividende de base
              let dividendeCalcule = await calculateDividende(nbre_actions || 0);
              
              // Bonus pour les gros actionnaires (plus de 1000 actions)
              if ((nbre_actions) < 1000 ) {
                dividendeCalcule += 10000; // Ajouter 10 000 FCFA de bonus
              }

              // Créer l'utilisateur avec le pays détecté
              const user = new User({
                firstName,
                lastName,
                telephone: telephoneAvecIndicatif, // Sauvegarder avec l'indicatif
                password: hashedPassword,
                role: "actionnaire",
                nbre_actions: nbre_actions || 0,
                dividende: dividendeCalcule,
                pays: paysDetecte // Ajouter le pays si le schéma le supporte
              });

              await user.save();

              // Préparer le message selon le pays
              let message;
              const flagPays = paysDetecte === 'SN' ? '🇸🇳' : paysDetecte === 'CI' ? '🇨🇮' : '🌍';
              
              if (messageLangue === 'fr') {
                // Ajouter une mention du bonus si applicable
                const bonusText = (nbre_actions || 0) < 1000 ? '\n🎉 Bonus gros porteur: +10 000 FCFA' : '';
                
                message = `👋 Bonjour ${firstName} ${lastName}, ${flagPays}

Votre compte actionnaire Dioko a été créé avec succès.

📱 Téléphone: ${telephoneAvecIndicatif}
🔑 Mot de passe: ${password}
💰 Actions: ${nbre_actions || 0}
💵 Dividende: ${dividendeCalcule.toFixed(2)} 

👉 Connectez-vous sur https://actionnaire.diokoclient.com

Bienvenue chez Dioko ! 🎉`;
              }

              // Envoyer le message WhatsApp (utiliser le numéro avec indicatif)
              await sendWhatsAppMessage(telephoneAvecIndicatif, message);

              results.success++;
              results.created.push({
                firstName,
                lastName,
                telephone: telephoneAvecIndicatif,
                nbre_actions: nbre_actions || 0,
                dividende: dividendeCalcule.toFixed(2),
                pays: paysDetecte,
                bonus_gros_porteur: (nbre_actions || 0) > 1000 // Indiquer si bonus appliqué
              });

              //(`✅ Actionnaire créé [${paysDetecte}]: ${firstName} ${lastName} - ${telephoneAvecIndicatif}`);

            } catch (error) {
              console.error(`❌ Erreur pour actionnaire ${i + index + 1}:`, error);
              results.errors.push({
                ligne: i + index + 1,
                donnees: actionnaireData,
                erreur: error.message
              });
            }
          }));

          // Pause entre les lots pour éviter de surcharger l'API WhatsApp
          if (i + batchSize < actionnaires.length) {
            //(`Lot ${Math.floor(i/batchSize) + 1} terminé, pause de 3 secondes...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
          }
        }

        // Message de résumé avec statistiques
        const resumeMessage = `Import terminé: ${results.success}/${results.total} actionnaires créés
🇸🇳 Sénégal: ${results.statistiques.parPays.senegal}
🇨🇮 Côte d'Ivoire: ${results.statistiques.parPays.coteIvoire}
❓ Indéterminés: ${results.statistiques.parPays.indetermine}`;

        res.status(200).json({
          success: true,
          message: resumeMessage,
          results
        });

      } catch (parseError) {
        res.status(500).json({
          success: false,
          message: "Erreur lors du parsing du fichier",
          error: parseError.message
        });
      }
    });

  } catch (error) {
    console.error('Erreur import en masse:', error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de l'import en masse",
      error: error.message
    });
  }
};

// Fonction utilitaire pour normaliser les numéros de téléphone
const normalizePhoneNumber = (phoneNumber, country) => {
  let cleanPhone = phoneNumber.replace(/\s/g, '');
  
  switch(country) {
    case 'SN':
      if (!cleanPhone.startsWith('+221') && !cleanPhone.startsWith('221')) {
        return `+221${cleanPhone}`;
      }
      break;
    case 'CI':
      if (!cleanPhone.startsWith('+225') && !cleanPhone.startsWith('225')) {
        return `+225${cleanPhone}`;
      }
      break;
  }
  
  return cleanPhone.startsWith('+') ? cleanPhone : `+${cleanPhone}`;
};

module.exports.normalizePhoneNumber = normalizePhoneNumber;

// Import depuis des données JSON
module.exports.bulkImportFromJSON = async (req, res) => {
  try {
    const { actionnaires } = req.body;

    if (!Array.isArray(actionnaires) || actionnaires.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Tableau d'actionnaires requis"
      });
    }

    // Vérifier qu'une entreprise existe
    const entreprise = await Entreprise.findOne().sort({ annee: -1 });
    if (!entreprise) {
      return res.status(400).json({
        success: false,
        message: "Aucune entreprise trouvée"
      });
    }

    const results = {
      total: actionnaires.length,
      success: 0,
      errors: [],
      created: []
    };

    // Traitement séquentiel pour éviter de surcharger WhatsApp
    for (let i = 0; i < actionnaires.length; i++) {
      try {
        const { firstName, lastName, telephone, nbre_actions } = actionnaires[i];

        // Validation
        if (!firstName || !lastName || !telephone) {
          results.errors.push({
            index: i,
            donnees: actionnaires[i],
            erreur: "Données manquantes"
          });
          continue;
        }

        // Vérifier unicité
        const existingUser = await User.findOne({ telephone });
        if (existingUser) {
          results.errors.push({
            index: i,
            donnees: actionnaires[i],
            erreur: "Utilisateur déjà existant"
          });
          continue;
        }

        // Créer le compte
        const password = generateRandomPassword();
        const hashedPassword = await bcrypt.hash(password, 10);
        const dividendeCalcule = await calculateDividende(nbre_actions || 0);

        const user = new User({
          firstName,
          lastName,
          telephone,
          password: hashedPassword,
          role: "actionnaire",
          nbre_actions: nbre_actions || 0,
          dividende: dividendeCalcule
        });

        await user.save();

        // Message WhatsApp
        const message = `👋 Bonjour ${firstName} ${lastName},\n\nVotre compte Dioko a été créé.\n\n📱 Tel: ${telephone}\n🔑 Mot de passe: ${password}\n💰 Actions: ${nbre_actions || 0}\n💸  FCFA\n\n👉 veuillez suivre ce lien pour vous connecter https://actionnaire.diokoclient.com ! 🎉`;

        await sendWhatsAppMessage(telephone, message);

        results.success++;
        results.created.push({
          firstName,
          lastName,
          telephone,
          nbre_actions: nbre_actions || 0,
          dividende: dividendeCalcule.toFixed(2)
        });

        // Pause d'1 seconde entre chaque envoi
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        results.errors.push({
          index: i,
          donnees: actionnaires[i],
          erreur: error.message
        });
      }
    }

    res.status(200).json({
      success: true,
      message: `Import JSON terminé: ${results.success}/${results.total} actionnaires créés`,
      results
    });

  } catch (error) {
    console.error('Erreur import JSON:', error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de l'import JSON",
      error: error.message
    });
  }
};

// Diagnostic PDF


// Prévisualisation PDF
module.exports.previewPDF = async (req, res) => {
  try {
    upload.single('file')(req, res, async (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: "Erreur upload",
          error: err.message
        });
      }

      if (!req.file || req.file.mimetype !== 'application/pdf') {
        return res.status(400).json({
          success: false,
          message: "Fichier PDF requis"
        });
      }

      try {
        const actionnaires = await parsePDFData(req.file.buffer);
        
        // Retourner seulement les 10 premiers pour prévisualisation
        const preview = actionnaires.slice(0, 10);
        
        res.status(200).json({
          success: true,
          message: `${actionnaires.length} actionnaires détectés dans le PDF`,
          total_detectes: actionnaires.length,
          preview: preview,
          recommandation: actionnaires.length > 10 ? 
            "Prévisualisez les premiers résultats. Si correct, lancez l'import complet." :
            "Tous les actionnaires détectés sont affichés."
        });

      } catch (parseError) {
        res.status(500).json({
          success: false,
          message: "Erreur lors de la prévisualisation du PDF",
          error: parseError.message,
          suggestion: "Essayez la route /bulk-import/diagnose pour analyser le PDF"
        });
      }
    });

  } catch (error) {
    console.error('Erreur prévisualisation PDF:', error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur",
      error: error.message
    });
  }
};

// Statut des imports
module.exports.getImportStatus = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({ role: 'actionnaire' });
    const recentUsers = await User.find({ 
      role: 'actionnaire',
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Dernières 24h
    }).select('firstName lastName telephone createdAt');

    res.status(200).json({
      success: true,
      statistiques: {
        totalActionnaires: totalUsers,
        nouveauxAujourdhui: recentUsers.length,
        derniersCreation: recentUsers.slice(0, 10)
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erreur récupération statut",
      error: error.message
    });
  }
};

module.exports.diagnosePDF = async (req, res) => {
  try {
    upload.single('file')(req, res, async (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: "Erreur upload",
          error: err.message
        });
      }

      if (!req.file || req.file.mimetype !== 'application/pdf') {
        return res.status(400).json({
          success: false,
          message: "Fichier PDF requis"
        });
      }

      //('=== DIAGNOSTIC PDF AVEC DETECTION PAYS ===');
      //('Taille du fichier:', req.file.size, 'bytes');

      const buffer = req.file.buffer;
      const bufferString = buffer.toString('utf8');
      const isEncrypted = bufferString.includes('/Encrypt');
      const hasText = bufferString.includes('ACTIONNAIRE') || /\d{9}/.test(bufferString);

      // Fonction pour détecter le pays d'un numéro
      const detectCountry = (phoneNumber) => {
        const cleanNumber = phoneNumber.replace(/\D/g, ''); // Enlever tous les non-chiffres
        
        // Sénégal - préfixes 7 (77, 78, 76, 75, 70) avec 9 chiffres
        if (cleanNumber.length === 9 && cleanNumber.startsWith('7')) {
          const prefix = cleanNumber.substring(0, 2);
          if (['77', '78', '76', '75', '70'].includes(prefix)) {
            return 'Sénégal';
          }
        }
        
        // Côte d'Ivoire - préfixes divers avec 8 ou 10 chiffres
        if (cleanNumber.length === 8 || cleanNumber.length === 10) {
          const prefix2 = cleanNumber.substring(0, 2);
          const prefix3 = cleanNumber.substring(0, 3);
          
          // Préfixes Côte d'Ivoire
          const ivoirePrefixes2 = ['07', '05', '01', '02', '03', '04', '06', '08', '09'];
          const ivoirePrefixes3 = ['225']; // Code pays
          
          if (ivoirePrefixes2.includes(prefix2) || ivoirePrefixes3.includes(prefix3)) {
            return 'Côte d\'Ivoire';
          }
        }
        
        // Numéros internationaux avec indicatif
        if (cleanNumber.length === 12 && cleanNumber.startsWith('221')) {
          return 'Sénégal (+221)';
        }
        if (cleanNumber.length === 11 && cleanNumber.startsWith('225')) {
          return 'Côte d\'Ivoire (+225)';
        }
        
        return 'Indéterminé';
      };

      // Analyse des numéros par pays
      const analyzePhoneNumbers = (text) => {
        // Regex améliorée pour capturer différents formats
        const phonePatterns = [
          // Format standard: numéro à 8-12 chiffres
          /\b(\d{8,12})\b/g,
          // Format avec préfixes internationaux
          /\b((?:\+|00)?(?:221|225)?\d{8,10})\b/g,
          // Format avec espaces ou tirets
          /\b(\d{2,3}[\s\-]?\d{2,3}[\s\-]?\d{2,4}[\s\-]?\d{2,4})\b/g
        ];

        const countryStats = {
          'Sénégal': [],
          'Côte d\'Ivoire': [],
          'Sénégal (+221)': [],
          'Côte d\'Ivoire (+225)': [],
          'Indéterminé': []
        };

        phonePatterns.forEach(pattern => {
          let match;
          const regex = new RegExp(pattern);
          while ((match = regex.exec(text)) !== null) {
            const number = match[1];
            const country = detectCountry(number);
            countryStats[country].push(number);
          }
        });

        // Supprimer les doublons
        Object.keys(countryStats).forEach(country => {
          countryStats[country] = [...new Set(countryStats[country])];
        });

        return countryStats;
      };

      let extractionResults = {
        method1: { success: false, textLength: 0, error: null },
        rawBuffer: { hasKeywords: hasText, isEncrypted: isEncrypted }
      };

      let phoneAnalysis = {};

      try {
        const data1 = await pdf(buffer);
        extractionResults.method1.success = true;
        extractionResults.method1.textLength = data1.text.length;
        extractionResults.method1.sample = data1.text.substring(0, 200);
        extractionResults.method1.numPages = data1.numpages;
        
        // Analyser les numéros de téléphone
        phoneAnalysis = analyzePhoneNumbers(data1.text);
      } catch (error) {
        extractionResults.method1.error = error.message;
        // Analyser depuis le buffer si l'extraction PDF échoue
        phoneAnalysis = analyzePhoneNumbers(bufferString);
      }

      // Patterns améliorés pour la détection
      const patterns = [
        // Ligne complète avec numéro sénégalais
        /(\d+)\s+([A-Za-zÀ-ÿ\s]+)\s+(7[0-8]\d{7})\s+([\d\.\s]+)/g,
        // Ligne complète avec numéro ivoirien 8 chiffres
        /(\d+)\s+([A-Za-zÀ-ÿ\s]+)\s+(0[1-9]\d{6,7})\s+([\d\.\s]+)/g,
        // Ligne complète avec numéro ivoirien 10 chiffres
        /(\d+)\s+([A-Za-zÀ-ÿ\s]+)\s+(225\d{8})\s+([\d\.\s]+)/g,
        // Mot-clé ACTIONNAIRE
        /ACTIONNAIRE/g,
        // Numéros à 9 chiffres (probablement Sénégal)
        /7[0-8]\d{7}/g,
        // Numéros à 8 chiffres commençant par 0 (probablement Côte d'Ivoire)
        /0[1-9]\d{6,7}/g
      ];

      const bufferMatches = {};
      patterns.forEach((pattern, index) => {
        const matches = bufferString.match(pattern);
        bufferMatches[`pattern${index}`] = matches ? matches.length : 0;
      });

      // Statistiques par pays
      const countryStats = {
        total: Object.values(phoneAnalysis).reduce((sum, arr) => sum + arr.length, 0),
        byCountry: {}
      };

      Object.keys(phoneAnalysis).forEach(country => {
        countryStats.byCountry[country] = {
          count: phoneAnalysis[country].length,
          examples: phoneAnalysis[country].slice(0, 3) // Premiers 3 exemples
        };
      });

      res.status(200).json({
        success: true,
        message: "Diagnostic PDF avec détection pays terminé",
        diagnostic: {
          fileInfo: {
            size: req.file.size,
            mimetype: req.file.mimetype,
            filename: req.file.originalname
          },
          extraction: extractionResults,
          phoneAnalysis: {
            byCountry: phoneAnalysis,
            statistics: countryStats
          },
          bufferAnalysis: {
            hasKeywords: hasText,
            isEncrypted: isEncrypted,
            patterns: bufferMatches
          },
          recommendations: [
            extractionResults.method1.success ? "✅ Extraction standard possible" : "❌ Extraction standard échouée",
            hasText ? "✅ Données détectées dans le buffer" : "❌ Aucune donnée détectée",
            isEncrypted ? "⚠️ PDF potentiellement chiffré" : "✅ PDF non chiffré",
            countryStats.byCountry['Sénégal']?.count > 0 ? `📱 ${countryStats.byCountry['Sénégal'].count} numéros sénégalais détectés` : "📱 Aucun numéro sénégalais détecté",
            countryStats.byCountry['Côte d\'Ivoire']?.count > 0 ? `📱 ${countryStats.byCountry['Côte d\'Ivoire'].count} numéros ivoiriens détectés` : "📱 Aucun numéro ivoirien détecté"
          ]
        }
      });
    });

  } catch (error) {
    console.error('Erreur diagnostic:', error);
    res.status(500).json({
      success: false,
      message: "Erreur lors du diagnostic",
      error: error.message
    });
  }
};

// Fonction utilitaire pour valider les numéros par pays
const validatePhoneNumber = (phoneNumber, country) => {
  const cleanNumber = phoneNumber.replace(/\D/g, '');
  
  switch(country) {
    case 'Sénégal':
      // Format: 7X XXX XXXX (9 chiffres)
      return /^7[0-8]\d{7}$/.test(cleanNumber);
      
    case 'Côte d\'Ivoire':
      // Format: 0X XXX XXXX (8 chiffres) ou +225 XX XXX XXXX (10 chiffres avec indicatif)
      return /^0[1-9]\d{6,7}$/.test(cleanNumber) || /^225\d{8}$/.test(cleanNumber);
      
    default:
      return false;
  }
};

module.exports.validatePhoneNumber = validatePhoneNumber;