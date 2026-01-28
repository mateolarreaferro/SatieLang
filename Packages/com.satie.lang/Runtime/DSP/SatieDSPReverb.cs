using UnityEngine;

namespace Satie
{
/// <summary>
/// High-quality plate reverb based on Freeverb algorithm
/// Uses 8 parallel comb filters + 4 series allpass filters
/// </summary>
[RequireComponent(typeof(AudioSource))]
public class SatieDSPReverb : MonoBehaviour
{
    // ===== REVERB PARAMETERS =====
    [Range(0f, 1f)] public float dryWet = 0.33f;        // 0 = dry only, 1 = wet only
    [Range(0f, 1f)] public float roomSize = 0.5f;       // 0 = small, 1 = large
    [Range(0f, 1f)] public float damping = 0.5f;        // High-frequency absorption
    [Range(0f, 1f)] public float width = 1f;            // Stereo width

    // ===== INTERPOLATION SUPPORT =====
    private MovementInterpolator dryWetInterpolator;
    private MovementInterpolator roomSizeInterpolator;
    private MovementInterpolator dampingInterpolator;

    private SatieDSPClock dspClock;
    private SatieRandom satieRandom;

    // ===== FREEVERB CONSTANTS =====
    private const int NUM_COMBS = 8;
    private const int NUM_ALLPASSES = 4;
    private const float FIXED_GAIN = 0.015f;
    private const float SCALE_WET = 3f;
    private const float SCALE_DAMPING = 0.4f;
    private const float SCALE_ROOM = 0.28f;
    private const float OFFSET_ROOM = 0.7f;

    // Comb filter tuning (optimized for 44.1kHz, scaled for actual sample rate)
    private static readonly int[] COMB_TUNING_L = { 1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617 };
    private static readonly int[] COMB_TUNING_R = { 1116+23, 1188+23, 1277+23, 1356+23, 1422+23, 1491+23, 1557+23, 1617+23 };

    // Allpass filter tuning
    private static readonly int[] ALLPASS_TUNING_L = { 556, 441, 341, 225 };
    private static readonly int[] ALLPASS_TUNING_R = { 556+23, 441+23, 341+23, 225+23 };

    // ===== DSP COMPONENTS =====
    private CombFilter[] combsL = new CombFilter[NUM_COMBS];
    private CombFilter[] combsR = new CombFilter[NUM_COMBS];
    private AllpassFilter[] allpassesL = new AllpassFilter[NUM_ALLPASSES];
    private AllpassFilter[] allpassesR = new AllpassFilter[NUM_ALLPASSES];

    private float gain;
    private float roomSize1;
    private float damp1;

    public void Initialize(SatieDSPClock clock, SatieRandom random, Statement stmt)
    {
        dspClock = clock;
        satieRandom = random;

        // Parse reverb parameters from statement
        if (stmt.reverbDryWetInterpolation != null)
        {
            dryWetInterpolator = new MovementInterpolator(stmt.reverbDryWetInterpolation, clock, random);
        }
        else if (stmt.reverbDryWet.isSet)
        {
            dryWet = satieRandom.Sample(stmt.reverbDryWet);
        }

        if (stmt.reverbRoomSizeInterpolation != null)
        {
            roomSizeInterpolator = new MovementInterpolator(stmt.reverbRoomSizeInterpolation, clock, random);
        }
        else if (stmt.reverbRoomSize.isSet)
        {
            roomSize = satieRandom.Sample(stmt.reverbRoomSize);
        }

        if (stmt.reverbDampingInterpolation != null)
        {
            dampingInterpolator = new MovementInterpolator(stmt.reverbDampingInterpolation, clock, random);
        }
        else if (stmt.reverbDamping.isSet)
        {
            damping = satieRandom.Sample(stmt.reverbDamping);
        }

        InitializeDSP();
    }

    void Awake()
    {
        InitializeDSP();
    }

    void InitializeDSP()
    {
        int sampleRate = AudioSettings.outputSampleRate;
        float tuningScale = sampleRate / 44100f;

        // Initialize comb filters
        for (int i = 0; i < NUM_COMBS; i++)
        {
            combsL[i] = new CombFilter(Mathf.RoundToInt(COMB_TUNING_L[i] * tuningScale));
            combsR[i] = new CombFilter(Mathf.RoundToInt(COMB_TUNING_R[i] * tuningScale));
        }

        // Initialize allpass filters
        for (int i = 0; i < NUM_ALLPASSES; i++)
        {
            allpassesL[i] = new AllpassFilter(Mathf.RoundToInt(ALLPASS_TUNING_L[i] * tuningScale));
            allpassesR[i] = new AllpassFilter(Mathf.RoundToInt(ALLPASS_TUNING_R[i] * tuningScale));
        }

        // Set initial parameters
        SetRoomSize(roomSize);
        SetDamping(damping);
        gain = FIXED_GAIN;
    }

    void Update()
    {
        // Update interpolated parameters
        if (dryWetInterpolator != null)
            dryWet = Mathf.Clamp01(dryWetInterpolator.GetValue());

        if (roomSizeInterpolator != null)
        {
            float newRoomSize = Mathf.Clamp01(roomSizeInterpolator.GetValue());
            if (Mathf.Abs(newRoomSize - roomSize) > 0.001f)
            {
                roomSize = newRoomSize;
                SetRoomSize(roomSize);
            }
        }

        if (dampingInterpolator != null)
        {
            float newDamping = Mathf.Clamp01(dampingInterpolator.GetValue());
            if (Mathf.Abs(newDamping - damping) > 0.001f)
            {
                damping = newDamping;
                SetDamping(damping);
            }
        }
    }

    void SetRoomSize(float value)
    {
        roomSize1 = value * SCALE_ROOM + OFFSET_ROOM;
        for (int i = 0; i < NUM_COMBS; i++)
        {
            combsL[i].SetFeedback(roomSize1);
            combsR[i].SetFeedback(roomSize1);
        }
    }

    void SetDamping(float value)
    {
        damp1 = value * SCALE_DAMPING;
        for (int i = 0; i < NUM_COMBS; i++)
        {
            combsL[i].SetDamp(damp1);
            combsR[i].SetDamp(damp1);
        }
    }

    void OnAudioFilterRead(float[] data, int channels)
    {
        if (combsL[0] == null) return; // Not initialized yet

        float wet1 = dryWet * SCALE_WET;
        float wet2 = wet1 * width;
        float dry = 1f - dryWet;

        for (int i = 0; i < data.Length; i += channels)
        {
            float inputL = data[i];
            float inputR = channels > 1 ? data[i + 1] : inputL;

            // Mix input to mono for reverb
            float input = (inputL + inputR) * gain;

            // Parallel comb filters
            float outL = 0f;
            float outR = 0f;

            for (int c = 0; c < NUM_COMBS; c++)
            {
                outL += combsL[c].Process(input);
                outR += combsR[c].Process(input);
            }

            // Series allpass filters
            for (int a = 0; a < NUM_ALLPASSES; a++)
            {
                outL = allpassesL[a].Process(outL);
                outR = allpassesR[a].Process(outR);
            }

            // Mix dry/wet with stereo width
            data[i] = dry * inputL + wet1 * outL + wet2 * outR;
            if (channels > 1)
                data[i + 1] = dry * inputR + wet1 * outR + wet2 * outL;
        }
    }

    // ===== COMB FILTER (with damping) =====
    private class CombFilter
    {
        private float[] buffer;
        private int bufferSize;
        private int bufferIndex;
        private float feedback;
        private float filterStore;
        private float damp1;
        private float damp2;

        public CombFilter(int size)
        {
            bufferSize = size;
            buffer = new float[size];
            bufferIndex = 0;
            filterStore = 0f;
        }

        public void SetFeedback(float val)
        {
            feedback = val;
        }

        public void SetDamp(float val)
        {
            damp1 = val;
            damp2 = 1f - val;
        }

        public float Process(float input)
        {
            float output = buffer[bufferIndex];

            // One-pole low-pass filter (damping)
            filterStore = output * damp2 + filterStore * damp1;

            buffer[bufferIndex] = input + filterStore * feedback;

            bufferIndex++;
            if (bufferIndex >= bufferSize)
                bufferIndex = 0;

            return output;
        }
    }

    // ===== ALLPASS FILTER =====
    private class AllpassFilter
    {
        private float[] buffer;
        private int bufferSize;
        private int bufferIndex;
        private const float FEEDBACK = 0.5f;

        public AllpassFilter(int size)
        {
            bufferSize = size;
            buffer = new float[size];
            bufferIndex = 0;
        }

        public float Process(float input)
        {
            float bufferOut = buffer[bufferIndex];
            float output = -input + bufferOut;
            buffer[bufferIndex] = input + bufferOut * FEEDBACK;

            bufferIndex++;
            if (bufferIndex >= bufferSize)
                bufferIndex = 0;

            return output;
        }
    }
}
}
