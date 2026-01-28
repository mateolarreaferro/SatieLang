using UnityEngine;

namespace Satie
{
/// <summary>
/// High-quality stereo delay with tempo sync, feedback, filtering, and ping-pong
/// Features: Linear interpolation for smooth delay time changes, low-pass filter in feedback
/// </summary>
[RequireComponent(typeof(AudioSource))]
public class SatieDSPDelay : MonoBehaviour
{
    // ===== DELAY PARAMETERS =====
    [Range(0f, 1f)] public float dryWet = 0.3f;         // 0 = dry only, 1 = wet only
    [Range(0.01f, 2f)] public float delayTime = 0.5f;   // Delay time in seconds
    [Range(0f, 0.95f)] public float feedback = 0.5f;    // Feedback amount (below 1 to avoid runaway)
    [Range(0f, 1f)] public float pingPong = 0f;         // 0 = normal stereo, 1 = full ping-pong
    [Range(200f, 20000f)] public float filterCutoff = 8000f; // Low-pass filter in feedback path

    // ===== INTERPOLATION SUPPORT =====
    private MovementInterpolator dryWetInterpolator;
    private MovementInterpolator delayTimeInterpolator;
    private MovementInterpolator feedbackInterpolator;
    private MovementInterpolator pingPongInterpolator;

    private SatieDSPClock dspClock;
    private SatieRandom satieRandom;

    // ===== DSP STATE =====
    private const float MAX_DELAY_TIME = 4f; // Maximum 4 seconds
    private float[] delayBufferL;
    private float[] delayBufferR;
    private int bufferSize;
    private int writeIndex;
    private float filterStateL;
    private float filterStateR;
    private int sampleRate;

    public void Initialize(SatieDSPClock clock, SatieRandom random, Statement stmt)
    {
        dspClock = clock;
        satieRandom = random;

        // Parse delay parameters from statement
        if (stmt.delayDryWetInterpolation != null)
        {
            dryWetInterpolator = new MovementInterpolator(stmt.delayDryWetInterpolation, clock, random);
        }
        else if (stmt.delayDryWet.isSet)
        {
            dryWet = satieRandom.Sample(stmt.delayDryWet);
        }

        if (stmt.delayTimeInterpolation != null)
        {
            delayTimeInterpolator = new MovementInterpolator(stmt.delayTimeInterpolation, clock, random);
        }
        else if (stmt.delayTime.isSet)
        {
            delayTime = satieRandom.Sample(stmt.delayTime);
        }

        if (stmt.delayFeedbackInterpolation != null)
        {
            feedbackInterpolator = new MovementInterpolator(stmt.delayFeedbackInterpolation, clock, random);
        }
        else if (stmt.delayFeedback.isSet)
        {
            feedback = satieRandom.Sample(stmt.delayFeedback);
        }

        if (stmt.delayPingPongInterpolation != null)
        {
            pingPongInterpolator = new MovementInterpolator(stmt.delayPingPongInterpolation, clock, random);
        }
        else if (stmt.delayPingPong.isSet)
        {
            pingPong = satieRandom.Sample(stmt.delayPingPong);
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
        bufferSize = Mathf.CeilToInt(MAX_DELAY_TIME * sampleRate);

        delayBufferL = new float[bufferSize];
        delayBufferR = new float[bufferSize];
        writeIndex = 0;
        filterStateL = 0f;
        filterStateR = 0f;
    }

    void Update()
    {
        // Update interpolated parameters
        if (dryWetInterpolator != null)
            dryWet = Mathf.Clamp01(dryWetInterpolator.GetValue());

        if (delayTimeInterpolator != null)
            delayTime = Mathf.Clamp(delayTimeInterpolator.GetValue(), 0.01f, MAX_DELAY_TIME);

        if (feedbackInterpolator != null)
            feedback = Mathf.Clamp01(feedbackInterpolator.GetValue()) * 0.95f;

        if (pingPongInterpolator != null)
            pingPong = Mathf.Clamp01(pingPongInterpolator.GetValue());
    }

    void OnAudioFilterRead(float[] data, int channels)
    {
        if (delayBufferL == null) return; // Not initialized

        // Calculate filter coefficient for low-pass (one-pole filter)
        float filterCoeff = Mathf.Exp(-2f * Mathf.PI * filterCutoff / sampleRate);

        // Calculate delay in samples (clamped to buffer size)
        int delaySamples = Mathf.Clamp(Mathf.RoundToInt(delayTime * sampleRate), 1, bufferSize - 1);

        for (int i = 0; i < data.Length; i += channels)
        {
            float inputL = data[i];
            float inputR = channels > 1 ? data[i + 1] : inputL;

            // Calculate read position with linear interpolation
            float readPosFloat = writeIndex - delaySamples;
            if (readPosFloat < 0) readPosFloat += bufferSize;

            int readPos = (int)readPosFloat;
            int readPosNext = (readPos + 1) % bufferSize;
            float frac = readPosFloat - readPos;

            // Read delayed samples with interpolation
            float delayedL = Mathf.Lerp(delayBufferL[readPos], delayBufferL[readPosNext], frac);
            float delayedR = Mathf.Lerp(delayBufferR[readPos], delayBufferR[readPosNext], frac);

            // Ping-pong: cross-feed delayed signals
            float feedbackL = Mathf.Lerp(delayedL, delayedR, pingPong);
            float feedbackR = Mathf.Lerp(delayedR, delayedL, pingPong);

            // Apply low-pass filter to feedback (prevents harsh buildup)
            filterStateL = filterStateL * filterCoeff + feedbackL * (1f - filterCoeff);
            filterStateR = filterStateR * filterCoeff + feedbackR * (1f - filterCoeff);

            // Write to delay buffer (input + filtered feedback)
            delayBufferL[writeIndex] = inputL + filterStateL * feedback;
            delayBufferR[writeIndex] = inputR + filterStateR * feedback;

            // Mix dry/wet
            float wet = dryWet;
            float dry = 1f - wet;

            data[i] = dry * inputL + wet * delayedL;
            if (channels > 1)
                data[i + 1] = dry * inputR + wet * delayedR;

            // Advance write index
            writeIndex++;
            if (writeIndex >= bufferSize)
                writeIndex = 0;
        }
    }
}
}
