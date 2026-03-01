import subprocess
import sys

def install():
    try:
        # 1. Detect platform and GPU for ONNX Runtime
        import platform
        import subprocess as sp
        
        gpu_type = "cpu"
        
        if platform.system() == "Windows": # Baseline for Windows consumer GPUs
            gpu_type = "directml"
            
            try:
                # Check for NVIDIA RTX/GTX presence
                # If NVIDIA is detected, we can safely upgrade to native CUDA
                nvidia_check = sp.check_output(["nvidia-smi"], stderr=sp.STDOUT)
                if b"NVIDIA" in nvidia_check:
                    gpu_type = "nvidia"
            except:
                pass

        # 2. Build install list
        pkgs = ["whisper-s2t", "imageio-ffmpeg", "audio-separator"]
        
        if gpu_type == "nvidia":
            pkgs.append("onnxruntime-gpu")
        elif gpu_type == "directml":
            pkgs.append("onnxruntime-directml")
        else:
            pkgs.append("onnxruntime")

        print(f"Detected GPU mode: {gpu_type}. Installing {', '.join(pkgs)}...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", *pkgs])
        print("Installation complete.")
    except Exception as e:
        print(f"Failed to install dependencies: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    install()
