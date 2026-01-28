using UnityEngine;

namespace Satie
{
/// <summary>
/// High-quality distortion/saturation effect with multiple algorithms
/// Modes: Soft clip, Hard clip, Tanh (tube-like), Cubic, Asymmetric
/// Includes pre-gain, drive, and post-gain with DC blocking filter
/// </summary>
[RequireComponent(typeof(AudioSource))]
public class SatieDSPDistortion : MonoBehaviour
{
    public enum DistortionMode
    {
        SoftClip,       // Smooth saturation (atan-based)
        HardClip,       // Hard limiting
        Tanh,           // Tube-like warm saturation
        Cubic,          // Smooth polynomial distortion
        Asymmetric      // Asymmetric clipping (more harmonics)
    }

    // ===== DISTORTION PARAMETERS =====
    public DistortionMode mode = DistortionMode.Tanh;
    [Range(0f, 1f)] public float drive = 0.5f;          // Distortion amount
    [Range(0f, 1f)] public float dryWet = 1f;           // 0 = dry (bypass), 1 = wet (distorted)
    [Range(-12f, 12f)] public float outputGain = 0f;    // Post-distortion gain (dB)

    // ===== INTERPOLATION SUPPORT =====
    private MovementInterpolator driveInterpolator;
    private MovementInterpolator dryWetInterpolator;

    private SatieDSPClock dspClock;
    private SatieRandom satieRandom;

    // ===== DSP STATE =====
    private float dcBlockerStateL;
    private float dcBlockerStateR;
    private const float DC_BLOCKER_COEFF = 0.995f; // High-pass at ~1Hz for 44.1kHz

    public void Initialize(SatieDSPClock clock, SatieRandom random, Statement stmt)
    {
        dspClock = clock;
        satieRandom = random;

        // Parse distortion mode
        if (stmt.distortionMode != null)
        {
            switch (stmt.distortionMode.ToLower())
            {
                case "softclip": mode = DistortionMode.SoftClip; break;
                case "hardclip": mode = DistortionMode.HardClip; break;
                case "tanh": mode = DistortionMode.Tanh; break;
                case "cubic": mode = DistortionMode.Cubic; break;
                case "asymmetric": mode = DistortionMode.Asymmetric; break;
            }
        }

        // Parse distortion parameters
        if (stmt.distortionDriveInterpolation != null)
        {
            driveInterpolator = new MovementInterpolator(stmt.distortionDriveInterpolation, clock, random);
        }
        else if (stmt.distortionDrive.isSet)
        {
            drive = satieRandom.Sample(stmt.distortionDrive);
        }

        if (stmt.distortionDryWetInterpolation != null)
        {
            dryWetInterpolator = new MovementInterpolator(stmt.distortionDryWetInterpolation, clock, random);
        }
        else if (stmt.distortionDryWet.isSet)
        {
            dryWet = satieRandom.Sample(stmt.distortionDryWet);
        }

        InitializeDSP();
    }

    void Awake()
    {
        InitializeDSP();
    }

    void InitializeDSP()
    {
        dcBlockerStateL = 0f;
        dcBlockerStateR = 0f;
    }

    void Update()
    {
        // Update interpolated parameters
        if (driveInterpolator != null)
            drive = Mathf.Clamp01(driveInterpolator.GetValue());

        if (dryWetInterpolator != null)
            dryWet = Mathf.Clamp01(dryWetInterpolator.GetValue());
    }

    void OnAudioFilterRead(float[] data, int channels)
    {
        // Calculate drive amount (exponential curve for better control)
        // Drive range: 1x to 100x gain
        float driveAmount = 1f + drive * drive * 99f;

        // Calculate output compensation (automatic makeup gain)
        float compensation = 1f / Mathf.Max(0.1f, 1f + drive * 2f);

        // Apply output gain (dB to linear)
        float outputMult = Mathf.Pow(10f, outputGain / 20f) * compensation;

        float wet = dryWet;
        float dry = 1f - wet;

        for (int i = 0; i < data.Length; i += channels)
        {
            float inputL = data[i];
            float inputR = channels > 1 ? data[i + 1] : inputL;

            // Apply drive
            float drivenL = inputL * driveAmount;
            float drivenR = inputR * driveAmount;

            // Apply distortion algorithm
            float distortedL = ApplyDistortion(drivenL, mode);
            float distortedR = ApplyDistortion(drivenR, mode);

            // DC blocking filter (removes DC offset from asymmetric distortion)
            distortedL = DCBlock(distortedL, ref dcBlockerStateL);
            distortedR = DCBlock(distortedR, ref dcBlockerStateR);

            // Apply output gain
            distortedL *= outputMult;
            distortedR *= outputMult;

            // Mix dry/wet
            data[i] = dry * inputL + wet * distortedL;
            if (channels > 1)
                data[i + 1] = dry * inputR + wet * distortedR;
        }
    }

    float ApplyDistortion(float x, DistortionMode mode)
    {
        switch (mode)
        {
            case DistortionMode.SoftClip:
                // Arctan soft clipping (smooth, musical)
                return (2f / Mathf.PI) * Mathf.Atan(x);

            case DistortionMode.HardClip:
                // Hard clipping (aggressive, harsh)
                return Mathf.Clamp(x, -1f, 1f);

            case DistortionMode.Tanh:
                // Hyperbolic tangent (tube-like warmth)
                // Using approximation for performance: tanh(x) ≈ x * (27 + x²) / (27 + 9x²)
                float x2 = x * x;
                return x * (27f + x2) / (27f + 9f * x2);

            case DistortionMode.Cubic:
                // Cubic soft clipping (smooth polynomial)
                // y = (3x - x³) / 2 for |x| <= 1, sign(x) for |x| > 1
                float absX = Mathf.Abs(x);
                if (absX <= 1f)
                    return x * (1.5f - 0.5f * x * x);
                else
                    return Mathf.Sign(x);

            case DistortionMode.Asymmetric:
                // Asymmetric clipping (diode-like, more harmonics)
                if (x > 0f)
                {
                    float xp = x * 1.5f;
                    float x2p = xp * xp;
                    return xp * (27f + x2p) / (27f + 9f * x2p);
                }
                else
                {
                    float xn = x * 0.7f;
                    float x2n = xn * xn;
                    return xn * (27f + x2n) / (27f + 9f * x2n);
                }

            default:
                return x;
        }
    }

    float DCBlock(float input, ref float state)
    {
        // First-order high-pass filter to remove DC offset
        // y[n] = x[n] - x[n-1] + α * y[n-1], where α ≈ 0.995
        float output = input - state + DC_BLOCKER_COEFF * state;
        state = output;
        return output;
    }

    // Public methods for runtime control
    public void SetDrive(float amount)
    {
        drive = Mathf.Clamp01(amount);
    }

    public void SetMode(DistortionMode newMode)
    {
        mode = newMode;
    }
}
}
