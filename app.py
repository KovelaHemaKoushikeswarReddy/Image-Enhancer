from flask import Flask, render_template, request, jsonify
import os
import subprocess
import datetime
from werkzeug.utils import secure_filename
import threading

from PIL import Image
import numpy as np
from skimage.metrics import peak_signal_noise_ratio, structural_similarity

# ---------------- Paths & Config ----------------

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Path to your Real-ESRGAN executable (change if needed)
REAL_ESRGAN_EXE = os.path.join(BASE_DIR, "realesrgan-ncnn-vulkan.exe")

UPLOAD_DIR = os.path.join(BASE_DIR, "static", "uploads")
OUTPUT_DIR = os.path.join(BASE_DIR, "static", "outputs")

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "bmp"}

app = Flask(__name__)

# ------- Global status (single-job) -------

current_status = {
    "running": False,
    "progress_text": "waiting...",
    "progress_value": 0.0,    # 0.0–1.0
    "input_url": None,
    "output_url": None,
    "baseline_url": None,     # bicubic baseline for model comparison
    "error": None,
    "metrics": None,          # image quality metrics
}


# ---------------- Helpers ----------------

def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def compute_image_metrics(input_path: str, output_path: str):
    """
    Compute demo-friendly metrics:
    - Resolution before and after
    - Pixel count increase & upscale factor
    - Estimated sharpness improvement (from gradients)
    - PSNR & SSIM between:
        * baseline = input image upscaled with simple interpolation
        * enhanced = Real-ESRGAN output
    """
    try:
        img_in_gray = Image.open(input_path).convert("L")
        img_out_gray = Image.open(output_path).convert("L")

        w_in, h_in = img_in_gray.size
        w_out, h_out = img_out_gray.size

        pixels_in = w_in * h_in
        pixels_out = w_out * h_out

        upscale_factor = pixels_out / pixels_in if pixels_in > 0 else 0.0
        pixel_increase_pct = (upscale_factor - 1.0) * 100.0 if upscale_factor > 0 else 0.0

        def sharpness_score(img):
            arr = np.array(img, dtype=np.float32) / 255.0
            gx = arr[:, 1:] - arr[:, :-1]
            gy = arr[1:, :] - arr[:-1, :]
            return float((np.abs(gx).mean() + np.abs(gy).mean()) / 2.0)

        sharp_in = sharpness_score(img_in_gray)
        sharp_out = sharpness_score(img_out_gray)

        sharpness_gain_pct = 0.0
        if sharp_in > 0:
            sharpness_gain_pct = ((sharp_out / sharp_in) - 1.0) * 100.0

        # For metric comparison, create a simple upscaled baseline (bicubic)
        img_in_resized = img_in_gray.resize((w_out, h_out), Image.BICUBIC)

        baseline = np.array(img_in_resized, dtype=np.float32) / 255.0
        enhanced = np.array(img_out_gray, dtype=np.float32) / 255.0

        psnr_val = peak_signal_noise_ratio(baseline, enhanced, data_range=1.0)
        ssim_val = structural_similarity(baseline, enhanced, data_range=1.0)

        # ----- Combined quality score (SSIM + PSNR, 30 dB = 100%) -----

        # SSIM: 0–1 → 0–100
        ssim_pct = max(0.0, min(float(ssim_val), 1.0)) * 100.0

        # PSNR: normalize with 30 dB taken as "good" (cap between 0 and 100)
        if np.isfinite(psnr_val):
            psnr_norm = psnr_val / 30.0          # 30 dB → 1.0 (100%)
            psnr_norm = max(0.0, min(psnr_norm, 1.0))
            psnr_pct = psnr_norm * 100.0
        else:
            psnr_pct = 0.0

        quality_score_pct = (ssim_pct + psnr_pct) / 2.0

        metrics = {
            "input_resolution": f"{w_in}×{h_in}",
            "output_resolution": f"{w_out}×{h_out}",
            "pixel_increase_pct": round(pixel_increase_pct, 1),
            "upscale_factor": round(upscale_factor, 2),
            "sharpness_input": round(sharp_in, 4),
            "sharpness_output": round(sharp_out, 4),
            "sharpness_gain_pct": round(sharpness_gain_pct, 1),
            "psnr_db": round(float(psnr_val), 2),
            "ssim": round(float(ssim_val), 4),
            "quality_score_pct": round(quality_score_pct, 1),
        }
        return metrics

    except Exception as e:
        print("Metric computation error:", e)
        return None


def run_esrgan(input_path: str, output_path: str, baseline_path: str):
    """Background thread: run Real-ESRGAN and update current_status."""
    global current_status

    cmd = [
        REAL_ESRGAN_EXE,
        "-i", input_path,
        "-o", output_path,
        "-n", "realesrgan-x4plus",
    ]

    print("Running:", " ".join(cmd))

    try:
        process = subprocess.Popen(
            cmd,
            cwd=BASE_DIR,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )

        for line in process.stdout:
            line = line.strip()
            if not line:
                continue

            print(line)

            if "%" in line:
                current_status["progress_text"] = line
                for token in line.split():
                    if "%" in token:
                        token_clean = token.replace("%", "")
                        try:
                            val = float(token_clean)
                            current_status["progress_value"] = max(
                                0.0, min(1.0, val / 100.0)
                            )
                        except ValueError:
                            pass

        process.wait()

        if process.returncode != 0:
            current_status["error"] = "Real-ESRGAN failed. Check server console."
            current_status["running"] = False
            return

        if not os.path.exists(output_path):
            current_status["error"] = f"Output file not found: {output_path}"
            current_status["running"] = False
            return

        # Generate bicubic baseline image for model comparison
        try:
            out_img = Image.open(output_path).convert("RGB")
            w_out, h_out = out_img.size

            in_img = Image.open(input_path).convert("RGB")
            baseline_img = in_img.resize((w_out, h_out), Image.BICUBIC)
            baseline_img.save(baseline_path)

            rel_baseline = os.path.relpath(baseline_path, BASE_DIR).replace("\\", "/")
            current_status["baseline_url"] = "/" + rel_baseline
        except Exception as e:
            print("Baseline generation error:", e)
            current_status["baseline_url"] = None

        # Compute metrics
        metrics = compute_image_metrics(input_path, output_path)

        rel_output = os.path.relpath(output_path, BASE_DIR).replace("\\", "/")
        current_status["output_url"] = "/" + rel_output
        current_status["progress_text"] = "Completed ✔"
        current_status["progress_value"] = 1.0
        current_status["running"] = False
        current_status["metrics"] = metrics

    except Exception as e:
        current_status["error"] = f"Exception: {e}"
        current_status["running"] = False


# ---------------- Routes ----------------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/start", methods=["POST"])
def start():
    """Start a new enhancement job."""
    global current_status

    if current_status["running"]:
        return jsonify({"error": "Another job is already running. Please wait."}), 400

    if "image" not in request.files:
        return jsonify({"error": "No file part."}), 400

    file = request.files["image"]

    if file.filename == "":
        return jsonify({"error": "No file selected."}), 400

    if not allowed_file(file.filename):
        return jsonify({"error": "Unsupported file type."}), 400

    safe_name = secure_filename(file.filename)
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    base, ext = os.path.splitext(safe_name)

    # Input image path
    input_filename = f"{base}_{timestamp}{ext}"
    input_path = os.path.join(UPLOAD_DIR, input_filename)
    file.save(input_path)

    # Output ESRGAN image path
    output_filename = f"{base}_x4_{timestamp}.png"
    output_path = os.path.join(OUTPUT_DIR, output_filename)

    # Bicubic baseline path
    baseline_filename = f"{base}_bicubic_{timestamp}.png"
    baseline_path = os.path.join(OUTPUT_DIR, baseline_filename)

    # Reset status
    current_status = {
        "running": True,
        "progress_text": "Starting...",
        "progress_value": 0.0,
        "error": None,
        "output_url": None,
        "baseline_url": None,
        "input_url": "/static/uploads/" + input_filename,
        "metrics": None,
    }

    t = threading.Thread(
        target=run_esrgan,
        args=(input_path, output_path, baseline_path),
        daemon=True
    )
    t.start()

    return jsonify(
        {
            "message": "Enhancement started.",
            "input_url": current_status["input_url"],
        }
    )


@app.route("/status")
def status():
    """Return current job status as JSON (polled by frontend)."""
    return jsonify(current_status)


if __name__ == "__main__":
    app.run(debug=True)
