using UnityEngine;

namespace Satie
{
    /// <summary>
    /// Keeps AudioSource alive after clip finishes to preserve effect tails
    /// (reverb decay, delay repeats, etc.)
    ///
    /// The trick: Set the clip to loop, but set volume to 0 after it finishes once.
    /// This keeps OnAudioFilterRead() running so effects can process their tails.
    /// </summary>
    [RequireComponent(typeof(AudioSource))]
    public class SatieDSPTailHandler : MonoBehaviour
    {
        private AudioSource audioSource;
        private float tailTime = 0f;
        private float clipLength = 0f;
        private float startTime = 0f;
        private bool tailStarted = false;
        private bool originalLoop = false;

        public void Initialize(AudioSource src, float calculatedTailTime, bool wasLoop)
        {
            audioSource = src;
            tailTime = calculatedTailTime;
            originalLoop = wasLoop;

            if (audioSource.clip != null)
            {
                clipLength = audioSource.clip.length / Mathf.Max(0.01f, audioSource.pitch);
                startTime = Time.time;

                // If it's a oneshot, we'll convert it to loop to keep OnAudioFilterRead running
                if (!wasLoop)
                {
                    audioSource.loop = true;
                }
            }
        }

        void Update()
        {
            if (audioSource == null) return;
            if (originalLoop) return; // Don't interfere with actual loops

            float elapsed = Time.time - startTime;

            // After clip finishes once, mute the source but keep it "playing"
            if (!tailStarted && elapsed >= clipLength)
            {
                tailStarted = true;
                audioSource.volume = 0f; // Mute the audio clip

                // Destroy after tail time
                Destroy(gameObject, tailTime);
            }
        }
    }
}
