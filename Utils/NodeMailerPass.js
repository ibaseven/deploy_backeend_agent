const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL,
        pass: process.env.PASSWORD,
    },
});

const sendPasswordResetEmail = (email, resetToken) => {
    
    const mailOptions = {
        from: 'sammbasow1999@gil.com',
        to: email,
        subject: 'Réinitialisation de mot de passe - Dioko',
        html: `
            <html>
                <head>
                    <style>
                        /* Styles CSS pour l'e-mail */
                        body {
                            font-family: Arial, sans-serif;
                        }

                        .container {
                            max-width: 600px;
                            margin: 0 auto;
                            padding: 20px;
                            background-color: #f9f9f9;
                            border: 1px solid #ddd;
                        }

                        .header {
                            background-color: #007bff;
                            color: #fff;
                            padding: 10px;
                            text-align: center;
                        }

                        .content {
                            padding: 20px;
                        }
                        a {
                            color: #00ABF3;
                        }
                    </style>
                </head>

                <body>
                    <div class="container">
                        <div class="header">
                            <h1>Réinitialisation de mot de passe</h1>
                        </div>
                        <div class="content">
                            <p>Vous avez demandé une réinitialisation de mot de passe pour votre compte Dioko. Cliquez sur le lien ci-dessous pour réinitialiser votre mot de passe :</p>
                            <a href="http://localhost:5001/api/reset-password/${resetToken}">Réinitialiser le mot de passe</a>
                            <p>Si vous n'avez pas demandé cette réinitialisation, vous pouvez ignorer cet e-mail.</p>
                        </div>
                    </div>
                </body>
            </html>
        `
    };

    // Envoi de l'e-mail
    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error(error);
        } else {
            //('E-mail de réinitialisation de mot de passe envoyé à :', email);
        }
    });
};



// ********************************************* //
// ********************************************* //

const sendVerificationEmail = async (email, verificationToken) => {
    const verificationLink = `http://localhost:3000/auth/validate-email?token=${verificationToken}`;
    // depuis la partie frontend on doit recupérer on doit recupére recupérer ce token et lancer la req de validation de l'email du user  
    const mailOptions = {
        from: 'sammbasow1999@gmail.com',
        to: email,
        subject: 'Vérification de votre adresse email',
        html: `
            <html>
                <head>
                    <style>
                        /* Styles CSS pour l'e-mail */
                        body {
                            font-family: Arial, sans-serif;
                        }

                        .container {
                            max-width: 600px;
                            margin: 0 auto;
                            padding: 20px;
                            background-color: #f9f9f9;
                            border: 1px solid #ddd;
                        }

                        .header {
                            background-color: #EE7706;
                            color: #fff;
                            padding: 10px;
                            text-align: center;
                        }

                        .content {
                            padding: 20px;
                        }
                        a {
                            color: #EE7706;
                        }
                    </style>
                </head>

                <body>
                    <div class="container">
                        <div class="header">
                            <h1>Vérification de votre adresse email</h1>
                        </div>
                        <div class="content">
                            <p>Merci de vous être inscrit sur notre plateforme. Veuillez cliquer sur le lien ci-dessous pour vérifier votre adresse email :</p>
                            <a href="${verificationLink}">Vérifier mon adresse email</a>
                            <p>Si vous n'avez pas demandé cette vérification, vous pouvez ignorer cet email.</p>
                        </div>
                    </div>
                </body>
            </html>
        
            `
    };

    try {
        await transporter.sendMail(mailOptions);
        //('Email de vérification envoyé à ' + email);
    } catch (error) {
        console.error('Erreur lors de l\'envoi de l\'email de vérification :', error);
    }
};

module.exports = { sendVerificationEmail,sendPasswordResetEmail };