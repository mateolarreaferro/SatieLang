using UnityEngine;

namespace Satie
{
/// <summary>
/// High-quality 3-band parametric EQ using biquad filters
/// Each band has: frequency, gain (dB), and Q (bandwidth)
/// Low shelf, parametric mid, high shelf topology
/// </summary>
[RequireComponent(typeof(AudioSource))]
public class SatieDSPEQ : MonoBehaviour
{
    // ===== LOW BAND (Shelf) =====
    [Range(20f, 1000f)] public float lowFreq = 100f;
    [Range(-24f, 24f)] public float lowGain = 0f;
    [Range(0.1f, 2f)] public float lowQ = 0.707f;

    // ===== MID BAND (Peak/Parametric) =====
    [Range(100f, 10000f)] public float midFreq = 1000f;
    [Range(-24f, 24f)] public float midGain = 0f;
    [Range(0.1f, 10f)] public float midQ = 1f;

    // ===== HIGH BAND (Shelf) =====
    [Range(1000f, 20000f)] public float highFreq = 8000f;
    [Range(-24f, 24f)] public float highGain = 0f;
    [Range(0.1f, 2f)] public float highQ = 0.707f;

    // ===== GLOBAL =====
    [Range(0f, 1f)] public float dryWet = 1f;

    // ===== INTERPOLATION SUPPORT =====
    private MovementInterpolator lowGainInterpolator;
    private MovementInterpolator midGainInterpolator;
    private MovementInterpolator highGainInterpolator;

    private SatieDSPClock dspClock;
    private SatieRandom satieRandom;

    // ===== BIQUAD FILTERS =====
    private BiquadFilter lowBandL, lowBandR;
    private BiquadFilter midBandL, midBandR;
    private BiquadFilter highBandL, highBandR;

    private int sampleRate;

    public void Initialize(SatieDSPClock clock, SatieRandom random, Statement stmt)
    {
        dspClock = clock;
        satieRandom = random;

        // Parse EQ parameters
        if (stmt.eqLowGainInterpolation != null)
        {
            lowGainInterpolator = new MovementInterpolator(stmt.eqLowGainInterpolation, clock, random);
        }
        else if (stmt.eqLowGain.isSet)
        {
            lowGain = satieRandom.Sample(stmt.eqLowGain);
        }

        if (stmt.eqMidGainInterpolation != null)
        {
            midGainInterpolator = new MovementInterpolator(stmt.eqMidGainInterpolation, clock, random);
        }
        else if (stmt.eqMidGain.isSet)
        {
            midGain = satieRandom.Sample(stmt.eqMidGain);
        }

        if (stmt.eqHighGainInterpolation != null)
        {
            highGainInterpolator = new MovementInterpolator(stmt.eqHighGainInterpolation, clock, random);
        }
        else if (stmt.eqHighGain.isSet)
        {
            highGain = satieRandom.Sample(stmt.eqHighGain);
        }
        InitializeDSP();
    }

    void Awake()
    {
        InitializeDSP();
    }

    void InitializeDSP()
    {
        sampleRate = AudioSettings.outputSampleRate;

        lowBandL = new BiquadFilter();
        lowBandR = new BiquadFilter();
        midBandL = new BiquadFilter();
        midBandR = new BiquadFilter();
        highBandL = new BiquadFilter();
        highBandR = new BiquadFilter();

        UpdateAllBands();
    }

    void Update()
    {
        bool needsUpdate = false;

        if (lowGainInterpolator != null)
        {
            float newGain = Mathf.Clamp(lowGainInterpolator.GetValue(), -24f, 24f);
            if (Mathf.Abs(newGain - lowGain) > 0.1f)
            {
                lowGain = newGain;
                needsUpdate = true;
            }
        }

        if (midGainInterpolator != null)
        {
            float newGain = Mathf.Clamp(midGainInterpolator.GetValue(), -24f, 24f);
            if (Mathf.Abs(newGain - midGain) > 0.1f)
            {
                midGain = newGain;
                needsUpdate = true;
            }
        }

        if (highGainInterpolator != null)
        {
            float newGain = Mathf.Clamp(highGainInterpolator.GetValue(), -24f, 24f);
            if (Mathf.Abs(newGain - highGain) > 0.1f)
            {
                highGain = newGain;
                needsUpdate = true;
            }
        }

        if (needsUpdate)
            UpdateAllBands();
    }

    void UpdateAllBands()
    {
        // Low shelf
        CalculateLowShelf(lowFreq, lowGain, lowQ, lowBandL);
        CalculateLowShelf(lowFreq, lowGain, lowQ, lowBandR);

        // Mid peak
        CalculatePeak(midFreq, midGain, midQ, midBandL);
        CalculatePeak(midFreq, midGain, midQ, midBandR);

        // High shelf
        CalculateHighShelf(highFreq, highGain, highQ, highBandL);
        CalculateHighShelf(highFreq, highGain, highQ, highBandR);
    }

    void OnAudioFilterRead(float[] data, int channels)
    {
        if (lowBandL == null) return;

        float wet = dryWet;
        float dry = 1f - wet;

        for (int i = 0; i < data.Length; i += channels)
        {
            float inputL = data[i];
            float inputR = channels > 1 ? data[i + 1] : inputL;

            // Process through filter chain (series)
            float outputL = lowBandL.Process(inputL);
            outputL = midBandL.Process(outputL);
            outputL = highBandL.Process(outputL);

            float outputR = channels > 1 ? lowBandR.Process(inputR) : outputL;
            if (channels > 1)
            {
                outputR = midBandR.Process(outputR);
                outputR = highBandR.Process(outputR);
            }

            // Mix dry/wet
            data[i] = dry * inputL + wet * outputL;
            if (channels > 1)
                data[i + 1] = dry * inputR + wet * outputR;
        }
    }

    // ===== BIQUAD COEFFICIENT CALCULATIONS =====

    void CalculateLowShelf(float freq, float gainDB, float q, BiquadFilter filter)
    {
        float A = Mathf.Pow(10f, gainDB / 40f);
        float w0 = 2f * Mathf.PI * freq / sampleRate;
        float cosW0 = Mathf.Cos(w0);
        float sinW0 = Mathf.Sin(w0);
        float alpha = sinW0 / (2f * q);

        float sqrtA = Mathf.Sqrt(A);
        float beta = sqrtA / q;

        filter.b0 = A * ((A + 1f) - (A - 1f) * cosW0 + beta * sinW0);
        filter.b1 = 2f * A * ((A - 1f) - (A + 1f) * cosW0);
        filter.b2 = A * ((A + 1f) - (A - 1f) * cosW0 - beta * sinW0);
        filter.a0 = (A + 1f) + (A - 1f) * cosW0 + beta * sinW0;
        filter.a1 = -2f * ((A - 1f) + (A + 1f) * cosW0);
        filter.a2 = (A + 1f) + (A - 1f) * cosW0 - beta * sinW0;

        filter.Normalize();
    }

    void CalculatePeak(float freq, float gainDB, float q, BiquadFilter filter)
    {
        float A = Mathf.Pow(10f, gainDB / 40f);
        float w0 = 2f * Mathf.PI * freq / sampleRate;
        float cosW0 = Mathf.Cos(w0);
        float sinW0 = Mathf.Sin(w0);
        float alpha = sinW0 / (2f * q);

        filter.b0 = 1f + alpha * A;
        filter.b1 = -2f * cosW0;
        filter.b2 = 1f - alpha * A;
        filter.a0 = 1f + alpha / A;
        filter.a1 = -2f * cosW0;
        filter.a2 = 1f - alpha / A;

        filter.Normalize();
    }

    void CalculateHighShelf(float freq, float gainDB, float q, BiquadFilter filter)
    {
        float A = Mathf.Pow(10f, gainDB / 40f);
        float w0 = 2f * Mathf.PI * freq / sampleRate;
        float cosW0 = Mathf.Cos(w0);
        float sinW0 = Mathf.Sin(w0);
        float alpha = sinW0 / (2f * q);

        float sqrtA = Mathf.Sqrt(A);
        float beta = sqrtA / q;

        filter.b0 = A * ((A + 1f) + (A - 1f) * cosW0 + beta * sinW0);
        filter.b1 = -2f * A * ((A - 1f) + (A + 1f) * cosW0);
        filter.b2 = A * ((A + 1f) + (A - 1f) * cosW0 - beta * sinW0);
        filter.a0 = (A + 1f) - (A - 1f) * cosW0 + beta * sinW0;
        filter.a1 = 2f * ((A - 1f) - (A + 1f) * cosW0);
        filter.a2 = (A + 1f) - (A - 1f) * cosW0 - beta * sinW0;

        filter.Normalize();
    }

    // ===== BIQUAD FILTER CLASS =====
    private class BiquadFilter
    {
        public float b0, b1, b2; // Feedforward coefficients
        public float a0, a1, a2; // Feedback coefficients
        private float z1, z2;     // State (delay elements)

        public BiquadFilter()
        {
            // Initialize as pass-through
            b0 = 1f; b1 = 0f; b2 = 0f;
            a0 = 1f; a1 = 0f; a2 = 0f;
            z1 = 0f; z2 = 0f;
        }

        public void Normalize()
        {
            // Normalize coefficients by a0
            b0 /= a0;
            b1 /= a0;
            b2 /= a0;
            a1 /= a0;
            a2 /= a0;
            a0 = 1f;
        }

        public float Process(float input)
        {
            // Direct Form II (transposed) - more numerically stable
            float output = b0 * input + z1;
            z1 = b1 * input - a1 * output + z2;
            z2 = b2 * input - a2 * output;
            return output;
        }
    }
}
}
