const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const multer = require("multer");

// AWS S3 configuration
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});


const upload = multer({ storage: multer.memoryStorage() });

// F
const uploadFiles = async (files) => {


  const uploadPromises = files.map(async (file) => {
    const fileName = file.originalname; // Use the original file name jhgfhdfds
    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype,
    };

    try {
      // Execute upload to S3
      await s3.send(new PutObjectCommand(params));
      ////("Upload successful for:", params.Key); // Log upload success

      // Retourner l'URL complète du fichier
      return fileName;
    } catch (error) {
      console.error("Error uploading to S3:", error); // Log any errors
      // Ne pas utiliser req ici car il n'est pas disponible dans ce contexte
      throw new Error(`Erreur lors de l'upload vers S3: ${error.message}`);
    }
  });

  // Wait for all uploads to complete
  const results = await Promise.all(uploadPromises);
  // //("Final Upload Results:", results); // Log final results

  // Filter out any failed uploads (null results)
  return results.filter(result => result !== null);
};

const uploadImg = (fields) => {
  return (req, res, next) => {
      // Utilisation de multer pour gérer le téléchargement des fichiers
      upload.fields(fields)(req, res, async (err) => {
          try {
              // Gestion des erreurs d'upload
              if (err) {
                  console.error("Erreur d'upload :", err);
                  return res.status(500).json({ error: req.t ? req.t('upload.errorDuringUpload') : "Erreur pendant l'upload" });
              }

              // Si aucun fichier n'est téléchargé, passer directement au middleware suivant
              if (!req.files || Object.keys(req.files).length === 0) {
                  //("Aucun fichier téléchargé. Passage au middleware suivant.");
                  return next();
              }

              // Traitement des fichiers uploadés
              const uploadedFiles = [];

              for (const field of fields) {
                  const files = req.files[field.name];
                  if (files && files.length > 0) {
                      uploadedFiles.push(...files);
                  }
              }

              // Upload des fichiers présents vers AWS S3
              if (uploadedFiles.length > 0) {
                  try {
                      const uploadedUrls = await uploadFiles(uploadedFiles);
                      // Stocker les URLs des fichiers uploadés dans req pour y accéder dans le contrôleur
                      req.uploadedFiles = uploadedUrls;
                  } catch (uploadError) {
                      console.error("Erreur lors de l'upload vers S3:", uploadError);
                      return res.status(500).json({ 
                          error: req.t ? req.t('upload.errorUploadingToS3') : "Erreur lors de l'upload vers S3" 
                      });
                  }
              }

              // Passe au middleware suivant
              next();
          } catch (error) {
              console.error("Erreur lors de la gestion des fichiers uploadés :", error);
              return res.status(500).json({ 
                  error: req.t ? req.t('upload.internalProcessingError') : "Erreur interne lors du traitement des fichiers" 
              });
          }
      });
  };
};

module.exports = { upload, uploadFiles, uploadImg };