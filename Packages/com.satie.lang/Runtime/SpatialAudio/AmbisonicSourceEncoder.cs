using UnityEngine;

namespace Satie
{
/// <summary>
/// Encodes a single AudioSource to First-Order Ambisonic (FOA) B-format.
/// This component must be added to each AudioSource that should be spatially encoded.
/// </summary>
[RequireComponent(typeof(AudioSource))]
public class AmbisonicSourceEncoder : MonoBehaviour
{
    private AudioSource audioSource;
    private Transform listenerTransform;
    private AmbisonicRecorder recorder;

    // Cached listener transform (set from main thread)
    private Vector3 cachedListenerPosition;
    private Quaternion cachedListenerRotation;
    private Vector3 cachedSourcePosition;
    private bool hasListenerCache = false;

    // B-format output buffers (W, X, Y, Z)
    public float[] outputW;
    public float[] outputX;
    public float[] outputY;
    public float[] outputZ;

    private int currentBufferSize = 0;

    void Awake()
    {
        audioSource = GetComponent<AudioSource>();

        // Find the AudioListener and recorder
        var listener = FindObjectOfType<AudioListener>();
        if (listener != null)
        {
            listenerTransform = listener.transform;
            recorder = listener.GetComponent<AmbisonicRecorder>();
        }

        if (recorder == null)
        {
            Debug.LogWarning($"[AmbisonicSourceEncoder] No AmbisonicRecorder found on AudioListener for {gameObject.name}");
        }
        else
        {
            Debug.Log($"[AmbisonicSourceEncoder] Initialized on {gameObject.name}, recorder found");
        }
    }

    void LateUpdate()
    {
        // Cache transforms on main thread for audio thread to use
        if (listenerTransform != null)
        {
            cachedListenerPosition = listenerTransform.position;
            cachedListenerRotation = listenerTransform.rotation;
            cachedSourcePosition = transform.position;
            hasListenerCache = true;
        }
    }

    /// <summary>
    /// Called by Unity's audio thread. Encodes this source's audio to B-format.
    /// NOTE: This runs on the audio thread, so we can't access Unity objects directly.
    /// </summary>
    void OnAudioFilterRead(float[] data, int channels)
    {
        if (!hasListenerCache || recorder == null) return;

        int frames = data.Length / channels;

        // Ensure buffers are large enough
        if (outputW == null || outputW.Length < frames)
        {
            currentBufferSize = frames;
            outputW = new float[frames];
            outputX = new float[frames];
            outputY = new float[frames];
            outputZ = new float[frames];
        }

        // Use cached source position (from main thread)
        Vector3 directionToSource = cachedSourcePosition - cachedListenerPosition;
        float distance = directionToSource.magnitude;

        // Normalize direction
        Vector3 direction = distance > 0.001f ? directionToSource / distance : Vector3.forward;

        // Transform direction to listener's local space
        Vector3 localDirection = Quaternion.Inverse(cachedListenerRotation) * direction;

        // Normalize to get unit vector
        float length = localDirection.magnitude;
        if (length > 0.001f)
        {
            localDirection /= length;
        }

        // Extract directional components (ambisonic encoding coefficients)
        // W = omnidirectional (constant)
        // X = front-back (forward component)
        // Y = left-right (right component)
        // Z = up-down (up component)

        float w = 0.707f; // 1/sqrt(2) normalization factor for W channel
        float x = localDirection.z; // Forward/back (Unity's Z axis)
        float y = localDirection.x; // Left/right (Unity's X axis)
        float z = localDirection.y; // Up/down (Unity's Y axis)

        // Process audio frames
        for (int i = 0; i < frames; i++)
        {
            // Get the audio sample (mono or convert stereo to mono)
            float monoSample = 0f;
            if (channels == 1)
            {
                monoSample = data[i];
            }
            else if (channels == 2)
            {
                monoSample = (data[i * 2] + data[i * 2 + 1]) * 0.5f;
            }

            // Apply distance attenuation (simple 1/r law)
            float attenuation = distance > 1f ? (1f / distance) : 1f;
            monoSample *= attenuation;

            // Encode to B-format using directional coefficients
            outputW[i] = monoSample * w;
            outputX[i] = monoSample * x;
            outputY[i] = monoSample * y;
            outputZ[i] = monoSample * z;
        }

        // Note: The recorder will pull this data via GetEncodedOutput()
    }

    /// <summary>
    /// Get the current encoded B-format output and MIX it into the provided buffers.
    /// Called from the audio thread by AmbisonicRecorder.
    /// </summary>
    public void GetEncodedOutput(float[] w, float[] x, float[] y, float[] z, int frames)
    {
        if (outputW == null || frames > currentBufferSize) return;

        // Mix our encoded output into the provided buffers
        int samplesToMix = Mathf.Min(frames, currentBufferSize);
        for (int i = 0; i < samplesToMix; i++)
        {
            w[i] += outputW[i];
            x[i] += outputX[i];
            y[i] += outputY[i];
            z[i] += outputZ[i];
        }
    }
}
}
