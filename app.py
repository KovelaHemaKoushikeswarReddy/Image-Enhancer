from flask import Flask, render_template, request, jsonify
import os
import datetime
from werkzeug.utils import secure_filename
import threading

from PIL import Image
import numpy as np
from skimage.metrics import peak_signal_noise_ratio, structural_similarity

import torch
from realesrgan import RealESRGAN

# ---------------- Paths & Config ----------------

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

UPLOAD_DIR = os.path.join(BASE_DIR, "static", "uploads")
OUTPUT_DIR = os.path.join(BASE_DIR, "static", "outputs")

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "bmp"}

app = Flask(__name__)

# ---------------- Model Load (ONCE) ----------------

device = torch.device("cpu")  # Render free = CPU only
model = RealESRGAN(device, scale=4)
model.load_weights("RealESRGAN_x4.pth", download=True)

# ---------------- Global Status ----------------

current_status = {
    "running": False,
    "progress_text": "waiting...",
    "progress_value": 0.0,
    "input_url": None,
    "output_url": None,
    "baseline_url": None,
    "error": None,
    "metrics": None,
}

# ---------------- Helpers ----------------

def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def compute_image_metrics(input_path, output_path):
    try:
        img_in = Image.open(input_path).convert("L")
        img_out = Image.open(output_path).convert("L")

        w_in, h_in = img_in.size
        w_out, h_out = img_out.size

        img_in_up = img_in.resize((w_out, h_out), Image.BICUBIC)

        baseline = np.array(img_in_up) / 255.0
        enhanced = np.array(img_out) / 255.0

        psnr_val = peak_signal_noise_ratio(baseline, enhanced, data_range=1.0)
        ssim_val = structural_similarity(baseline, enhanced, data_range=1.0)

        return {
            "input_resolution": f"{w_in}×{h_in}",
            "output_resolution": f"{w_out}×{h_out}",
            "psnr_db": round(float(psnr_val), 2),
            "ssim": round(float(ssim_val), 4),
        }

    except Exception as e:
        print("Metric error:", e)
        return None


def run_esrgan(input_path, output_path, baseline_path):
    global current_status

    try:
        current_status["progress_text"] = "Enhancing image..."
        current_status["progress_value"] = 0.4

        img = Image.open(input_path).convert("RGB")
        sr_image = model.predict(img)

        sr_image.save(output_path)

        # baseline
        baseline = img.resize(sr_image.size, Image.BICUBIC)
        baseline.save(baseline_path)

        metrics = compute_image_metrics(input_path, output_path)

        current_status.update({
            "running": False,
            "progress_text": "Completed ✔",
            "progress_value": 1.0,
            "output_url": "/static/outputs/" + os.path.basename(output_path),
            "baseline_url": "/static/outputs/" + os.path.basename(baseline_path),
            "metrics": metrics
        })

    except Exception as e:
        current_status["error"] = str(e)
        current_status["running"] = False


# ---------------- Routes ----------------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/start", methods=["POST"])
def start():
    global current_status

    if current_status["running"]:
        return jsonify({"error": "Another job is running"}), 400

    file = request.files.get("image")
    if not file or file.filename == "":
        return jsonify({"error": "No file selected"}), 400

    if not allowed_file(file.filename):
        return jsonify({"error": "Invalid file type"}), 400

    safe_name = secure_filename(file.filename)
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    base, ext = os.path.splitext(safe_name)

    input_path = os.path.join(UPLOAD_DIR, f"{base}_{ts}{ext}")
    output_path = os.path.join(OUTPUT_DIR, f"{base}_x4_{ts}.png")
    baseline_path = os.path.join(OUTPUT_DIR, f"{base}_bicubic_{ts}.png")

    file.save(input_path)

    current_status = {
        "running": True,
        "progress_text": "Starting...",
        "progress_value": 0.1,
        "input_url": "/static/uploads/" + os.path.basename(input_path),
        "output_url": None,
        "baseline_url": None,
        "metrics": None,
        "error": None,
    }

    threading.Thread(
        target=run_esrgan,
        args=(input_path, output_path, baseline_path),
        daemon=True
    ).start()

    return jsonify({"message": "Started", "input_url": current_status["input_url"]})


@app.route("/status")
def status():
    return jsonify(current_status)


# ---------------- Render Entry ----------------

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
