# mobilePCD - Real-Time Pitch Class Distribution Analyzer

A web-based real-time audio analyzer that visualizes pitch class distribution (PCD) in a circular format with an integrated precision tuning needle. Perfect for musicians, music educators, and audio analysis enthusiasts.

## dft and idft expected results from amicad paper
<img width="643" height="304" alt="image" src="https://github.com/user-attachments/assets/ca802824-69fc-4caa-8896-c9e92884f369" />



## 🎵 Features

### Visual Components
- **Circular PCD Ring**: 12-segment chromatic wheel showing real-time pitch class energy distribution
- **Interactive Rotation**: Touch/drag to rotate the ring for preferred orientation (reset with "Reset ring" button)
- **Precision Tuning Needle**: Shows the dominant frequency with smooth tracking and cent deviation display
- **Color-Coded Layout**: Each pitch class has its own color with visual distinction for black keys (sharps/flats)

### Audio Processing
- **High-Resolution FFT**: 16,384-sample window with 4,096-sample hop for excellent frequency resolution
- **Real-Time Analysis**: WebAudio API with AudioWorklet for low-latency processing
- **Smart Peak Detection**: Parabolic interpolation for sub-bin frequency accuracy
- **Prominence Filtering**: Configurable minimum peak prominence to ignore noise

### Tuning System
- **Configurable A4 Reference**: Default 440 Hz (standard concert pitch)
- **Cent Precision**: Shows deviation in cents (±50¢ range around nearest semitone)
- **Smoothed Response**: EMA filtering prevents jittery needle movement
- **Noise Gating**: RMS threshold to ignore quiet background noise

### User Controls
- **Reactivity Slider** (0.05-1.00): Controls needle smoothing - lower = smoother, higher = more responsive
- **Min Prominence** (0-24 dB): Minimum peak prominence required to show tuning needle
- **Min RMS** (0-0.02): Noise gate threshold to filter out quiet frames

## 🚀 Usage

1. **Start Analysis**: Click "Start mic" to begin real-time audio capture
2. **Play/Sing**: The ring will show energy distribution across all 12 pitch classes
3. **Tune Instruments**: The blue needle points to the dominant frequency with cent deviation
4. **Adjust Settings**: Fine-tune reactivity, prominence, and noise gate as needed
5. **Rotate View**: Drag the ring to orient your preferred note at 12 o'clock

## 🔧 Technical Specifications

### Audio Processing
- **Sample Rate**: Adaptive (typically 48 kHz)
- **Window Size**: 16,384 samples (~341ms @ 48kHz)
- **Hop Size**: 4,096 samples (~85ms @ 48kHz)
- **Frequency Range**: 50 Hz - 5 kHz (configurable)
- **Window Function**: Hann window for spectral leakage reduction

### Analysis Algorithm
- **FFT**: Custom radix-2 Cooley-Tukey implementation
- **PCD Calculation**: MIDI-based pitch class mapping with power weighting
- **Peak Detection**: Local maximum with prominence calculation
- **Frequency Estimation**: Parabolic interpolation around peak bin

### Display Features
- **Responsive Design**: Adapts to mobile and desktop screens
- **High DPI Support**: Scales with device pixel ratio
- **Dark/Light Theme**: Follows system color scheme preference
- **Touch Optimized**: Full touch support for mobile devices

## 🎯 Use Cases

- **Instrument Tuning**: Precise tuning for guitars, pianos, strings, etc.
- **Vocal Training**: Real-time pitch feedback for singers
- **Music Education**: Visualize harmony and chord structures
- **Audio Analysis**: Research tool for pitch content analysis
- **Live Performance**: Monitor tuning during performances

## 📱 Compatibility

- **Modern Browsers**: Chrome, Firefox, Safari, Edge (requires WebAudio API)
- **Mobile Devices**: iOS Safari, Android Chrome with microphone access
- **Desktop**: Windows, macOS, Linux with microphone permissions

## 🛠️ Architecture

Modular web application with clean separation of concerns:
- **`index.html`**: Clean HTML structure and layout
- **`styles.css`**: Responsive CSS with mobile-first design
- **`script.js`**: Complete audio processing and visualization logic
- **Vanilla JavaScript**: No external dependencies
- **WebAudio API**: Real-time audio processing
- **Canvas 2D**: Hardware-accelerated graphics
- **CSS Grid/Flexbox**: Responsive layout
- **Modern ES6+**: Modules, async/await, destructuring

## � Local Development

### Quick Start
```bash
# Navigate to project directory
cd mobilePCD

# Start local development server
python3 -m http.server 8000

# Open in browser
# http://localhost:8000
```

### File Structure
```
mobilePCD/
├── index.html          # Main HTML structure
├── styles.css          # Responsive styling
├── script.js           # Audio processing & visualization
└── README.md           # Documentation
```

**Note**: Due to browser security restrictions (CORS), the application must be served via HTTP/HTTPS. Opening `index.html` directly as a file will not work properly.

## �📊 Output Data

The analyzer exposes:
- **PCD Array**: 12-element Float32Array of normalized pitch class energies
- **Primary Frequency**: Dominant frequency with confidence metrics
- **Cent Deviation**: Precise tuning offset from nearest semitone
- **Custom Events**: `pcd` event dispatched on each analysis frame

---

*Modular web application - serve via HTTP server to start analyzing!*
