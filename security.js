// URL de ton modèle Teachable Machine
const URL = "./my_model/";

let model, webcam, labelContainer, maxPredictions;

async function initSecurity() {
    const modelURL = URL + "model.json";
    const metadataURL = URL + "metadata.json";

    model = await tmImage.load(modelURL, metadataURL);
    maxPredictions = model.getTotalClasses();

    const flip = true;
    webcam = new tmImage.Webcam(250, 250, flip);
    await webcam.setup();
    await webcam.play();
    window.requestAnimationFrame(loop);

    document.getElementById("webcam-container").appendChild(webcam.canvas);
    labelContainer = document.getElementById("label-container");

    for (let i = 0; i < maxPredictions; i++) {
        labelContainer.appendChild(document.createElement("div"));
    }
}

async function loop() {
    webcam.update();
    await predict();
    window.requestAnimationFrame(loop);
}

async function predict() {
    const prediction = await model.predict(webcam.canvas);

    // 🔐 Classes autorisées (remplace par les noms EXACTS de ton modèle)
    const allowedClasses = ["Visage_OK", "Carte_OK"];

    for (let i = 0; i < prediction.length; i++) {
        const className = prediction[i].className;
        const probability = prediction[i].probability;

        labelContainer.childNodes[i].innerHTML =
            className + ": " + probability.toFixed(2);

        // 🔒 Contrôle d’accès
        if (allowedClasses.includes(className) && probability > 0.90) {
            document.getElementById("security-screen").style.display = "none";
            document.querySelector(".app").style.display = "block";
        }
    }
}
