using UnityEngine;

namespace Satie
{
/// <summary>
/// High-quality multi-mode filter using State Variable Filter (SVF) topology
/// Modes: Low-pass, High-pass, Band-pass, Notch, Peak
/// Features smooth, stable frequency response with resonance control
/// </summary>
[RequireComponent(typeof(AudioSource))]
public class SatieDSPFilter : MonoBehaviour
{
    public enum FilterMode
    {
        LowPass,
        HighPass,
        BandPass,
        Notch,
        Peak
    }

    // ===== FILTER PARAMETERS =====
    public FilterMode mode = FilterMode.LowPass;
    [Range(20f, 20000f)] public float cutoffFrequency = 1000f;
    [Range(0.1f, 10f)] public float resonance = 0.707f; // Q factor (0.707 = Butterworth/flat, >1 = resonant)
    [Range(0f, 1f)] public float dryWet = 1f;           // 0 = dry (bypass), 1 = wet (filtered)

    // ===== INTERPOLATION SUPPORT =====
    private MovementInterpolator cutoffInterpolator;
    private MovementInterpolator resonanceInterpolator;
    private MovementInterpolator dryWetInterpolator;

    private SatieDSPClock dspClock;
    private SatieRandom satieRandom;
    private bool initialized = false;

    // ===== SVF STATE VARIABLES =====
    private float ic1eqL, ic2eqL; // Left channel integrator states
    private float ic1eqR, ic2eqR; // Right channel integrator states
    private float g, k;            // Filter coefficients
    private float a1, a2, a3;      // Mix coefficients for different modes
    private int sampleRate;

    public void Initialize(SatieDSPClock clock, SatieRandom random, Statement stmt)
    {
        dspClock = clock;
        satieRandom = random;

        // Parse filter mode
        if (stmt.filterMode != null)
        {
            switch (stmt.filterMode.ToLower())
            {
                case "lowpass": mode = FilterMode.LowPass; break;
                case "highpass": mode = FilterMode.HighPass; break;
                case "bandpass": mode = FilterMode.BandPass; break;
                case "notch": mode = FilterMode.Notch; break;
                case "peak": mode = FilterMode.Peak; break;
            }
        }

        // Parse filter parameters
        if (stmt.filterCutoffInterpolation != null)
        {
            cutoffInterpolator = new MovementInterpolator(stmt.filterCutoffInterpolation, clock, random);
        }
        else if (stmt.filterCutoff.isSet)
        {
            cutoffFrequency = satieRandom.Sample(stmt.filterCutoff);
        }

        if (stmt.filterResonanceInterpolation != null)
        {
            resonanceInterpolator = new MovementInterpolator(stmt.filterResonanceInterpolation, clock, random);
        }
        else if (stmt.filterResonance.isSet)
        {
            resonance = satieRandom.Sample(stmt.filterResonance);
        }

        if (stmt.filterDryWetInterpolation != null)
        {
            dryWetInterpolator = new MovementInterpolator(stmt.filterDryWetInterpolation, clock, random);
        }
        else if (stmt.filterDryWet.isSet)
        {
            dryWet = satieRandom.Sample(stmt.filterDryWet);
        }

        InitializeDSP();
        initialized = true;
    }

    void Awake()
    {
        if (!initialized)
            InitializeDSP();
    }

    void InitializeDSP()
    {
        sampleRate = AudioSettings.outputSampleRate;
        ic1eqL = ic2eqL = 0f;
        ic1eqR = ic2eqR = 0f;
        UpdateCoefficients();
    }

    void Update()
    {
        bool needsUpdate = false;

        // Update interpolated parameters
        if (cutoffInterpolator != null)
        {
            float newCutoff = Mathf.Clamp(cutoffInterpolator.GetValue(), 20f, 20000f);
            if (Mathf.Abs(newCutoff - cutoffFrequency) > 1f)
            {
                cutoffFrequency = newCutoff;
                needsUpdate = true;
            }
        }

        if (resonanceInterpolator != null)
        {
            float newResonance = Mathf.Clamp(resonanceInterpolator.GetValue(), 0.1f, 10f);
            if (Mathf.Abs(newResonance - resonance) > 0.01f)
            {
                resonance = newResonance;
                needsUpdate = true;
            }
        }

        if (dryWetInterpolator != null)
            dryWet = Mathf.Clamp01(dryWetInterpolator.GetValue());

        if (needsUpdate)
            UpdateCoefficients();
    }

    void UpdateCoefficients()
    {
        // State Variable Filter design (Chamberlin/Hal Chamberlin topology)
        // Based on "The Art of VA Filter Design" by Vadim Zavalishin

        // Pre-warp the cutoff frequency for better high-frequency response
        float wc = 2f * Mathf.PI * Mathf.Clamp(cutoffFrequency, 20f, sampleRate * 0.49f);
        float wa = 2f * sampleRate * Mathf.Tan(wc / (2f * sampleRate));

        // Calculate g (frequency parameter)
        g = wa / (2f * sampleRate);

        // Clamp g to prevent instability
        g = Mathf.Clamp(g, 0.0001f, 0.99f);

        // Calculate k (resonance/damping parameter)
        // For SVF: k = 1/Q (higher k = less resonance, more damping)
        k = 1f / Mathf.Max(0.1f, resonance);

        // Clamp k to safe range (0.1 to 10, corresponding to Q from 10 to 0.1)
        k = Mathf.Clamp(k, 0.1f, 10f);

        // Set mix coefficients based on filter mode
        switch (mode)
        {
            case FilterMode.LowPass:
                a1 = 0f; a2 = 0f; a3 = 1f;
                break;
            case FilterMode.HighPass:
                a1 = 1f; a2 = -k; a3 = -1f;
                break;
            case FilterMode.BandPass:
                a1 = 0f; a2 = 1f; a3 = 0f;
                break;
            case FilterMode.Notch:
                a1 = 1f; a2 = -k; a3 = 0f;
                break;
            case FilterMode.Peak:
                a1 = 1f; a2 = -k; a3 = -2f;
                break;
        }
    }

    void OnAudioFilterRead(float[] data, int channels)
    {
        // Safety check: only process if initialized and wet > 0
        if (!initialized || dryWet < 0.001f)
            return;

        float wet = dryWet;
        float dry = 1f - wet;

        for (int i = 0; i < data.Length; i += channels)
        {
            float inputL = data[i];
            float inputR = channels > 1 ? data[i + 1] : inputL;

            // Process left channel
            float outputL = ProcessSample(inputL, ref ic1eqL, ref ic2eqL);

            // Process right channel
            float outputR = channels > 1 ? ProcessSample(inputR, ref ic1eqR, ref ic2eqR) : outputL;

            // Safety: Check for NaN/Inf
            if (float.IsNaN(outputL) || float.IsInfinity(outputL)) outputL = 0f;
            if (float.IsNaN(outputR) || float.IsInfinity(outputR)) outputR = 0f;

            // Mix dry/wet
            data[i] = dry * inputL + wet * outputL;
            if (channels > 1)
                data[i + 1] = dry * inputR + wet * outputR;
        }
    }

    float ProcessSample(float input, ref float ic1eq, ref float ic2eq)
    {
        // State Variable Filter core algorithm (TPT form - Topology Preserving Transform)
        // This form is numerically stable and handles parameter changes smoothly

        // Calculate v3 (high-pass output)
        float v3 = input - ic2eq;

        // Calculate v1 (band-pass output)
        float denominator = 1f + g * (g + k);
        // Safety check to prevent division by zero
        if (Mathf.Abs(denominator) < 0.00001f)
            denominator = 0.00001f;

        float v1 = (ic1eq + g * v3) / denominator;

        // Calculate v2 (low-pass output)
        float v2 = ic2eq + g * v1;

        // Update integrator states
        ic1eq = 2f * v1 - ic1eq;
        ic2eq = 2f * v2 - ic2eq;

        // Safety: Clamp integrator states to prevent runaway
        ic1eq = Mathf.Clamp(ic1eq, -10f, 10f);
        ic2eq = Mathf.Clamp(ic2eq, -10f, 10f);

        // Mix outputs based on mode
        float output = a1 * v3 + a2 * v1 + a3 * v2;

        // Final safety clamp
        return Mathf.Clamp(output, -10f, 10f);
    }

    // Public methods for runtime control
    public void SetCutoff(float freq)
    {
        cutoffFrequency = Mathf.Clamp(freq, 20f, 20000f);
        UpdateCoefficients();
    }

    public void SetResonance(float q)
    {
        resonance = Mathf.Clamp(q, 0.1f, 10f);
        UpdateCoefficients();
    }

    public void SetMode(FilterMode newMode)
    {
        mode = newMode;
        UpdateCoefficients();
    }
}
}
