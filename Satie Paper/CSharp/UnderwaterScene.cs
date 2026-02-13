using UnityEngine;
using System.Collections;

public class UnderwaterScene : MonoBehaviour
{
    public AudioClip ambience, bubble, whale, dolphin, rumble, splash;
    float groupVol;

    void Start()
    {
        StartCoroutine(GroupFadeIn(5f));

        // Ambience loop
        var amb = MakeSrc(ambience, true, 0.5f);
        amb.gameObject.AddComponent<AudioReverbFilter>().reverbLevel = -600; // wet ~0.2
        amb.Play();

        // 5 bubbles: volume 0.1-0.3, pitch 0.7-2, walk, visual sphere
        for (int i = 0; i < 5; i++)
            StartCoroutine(OneshotLoop(bubble, 1f, 10f, 0.1f, 0.3f, 0.7f, 2f, go => {
                AddWalkMovement(go.transform, -5f, 5f, -5f, 5f, Random.Range(2f, 3f));
                AddSphere(go);
            }));

        // 5 whales: volume 0.6-1, xyz movement, visual trail, color blue
        for (int i = 0; i < 5; i++)
            StartCoroutine(OneshotLoop(whale, 10f, 15f, 0.6f, 1f, 1f, 1f, go => {
                AddFlyMovement(go.transform, new Vector3(-10, -10, -5), new Vector3(10, 10, 5),
                    Random.Range(0.5f, 2f));
                AddTrail(go, Color.blue);
                go.GetComponent<Renderer>().material.color = Color.blue;
            }));

        // 3 dolphins: volume 0.2-0.3, pitch 0.8-1.5, y movement 5-15
        for (int i = 0; i < 3; i++)
            StartCoroutine(OneshotLoop(dolphin, 10f, 20f, 0.2f, 0.3f, 0.8f, 1.5f, go => {
                AddFlyMovement(go.transform, new Vector3(0, 5, 0), new Vector3(0, 15, 0),
                    Random.Range(1f, 3f));
            }));

        // 1 rumble: volume 0.2
        StartCoroutine(OneshotLoop(rumble, 15f, 25f, 0.2f, 0.2f, 1f, 1f, null));

        // 2 splashes: volume 0.01-0.1, pitch 0.8-1.2, y movement 10-11
        for (int i = 0; i < 2; i++)
            StartCoroutine(OneshotLoop(splash, 5f, 12f, 0.01f, 0.1f, 0.8f, 1.2f, go => {
                AddFlyMovement(go.transform, new Vector3(0, 10, 0), new Vector3(0, 11, 0), 1f);
            }));
    }

    AudioSource MakeSrc(AudioClip clip, bool loop, float vol, float pitch = 1f)
    {
        var go = new GameObject($"[Snd] {clip.name}");
        go.transform.SetParent(transform);
        var src = go.AddComponent<AudioSource>();
        src.clip = clip;
        src.loop = loop;
        src.volume = vol * groupVol;
        src.pitch = pitch;
        src.spatialBlend = 1f;
        src.spatialize = true;
        src.rolloffMode = AudioRolloffMode.Logarithmic;
        src.minDistance = 1f;
        src.maxDistance = 100f;
        return src;
    }

    IEnumerator GroupFadeIn(float dur)
    {
        groupVol = 0f;
        for (float t = 0; t < dur; t += Time.deltaTime)
        {
            float n = t / dur;
            groupVol = n * n; // inquad easing
            yield return null;
        }
        groupVol = 1f;
    }

    IEnumerator OneshotLoop(AudioClip clip, float minEvery, float maxEvery,
        float minVol, float maxVol, float minPitch, float maxPitch,
        System.Action<GameObject> setup)
    {
        while (true)
        {
            yield return new WaitForSeconds(Random.Range(minEvery, maxEvery));
            var src = MakeSrc(clip, false, Random.Range(minVol, maxVol),
                Random.Range(minPitch, maxPitch));
            setup?.Invoke(src.gameObject);
            src.Play();
            Destroy(src.gameObject, clip.length + 1f);
        }
    }

    void AddWalkMovement(Transform t, float xMin, float xMax, float zMin, float zMax, float speed)
    {
        StartCoroutine(PerlinMove(t, new Vector3(xMin, 0, zMin), new Vector3(xMax, 0, zMax), speed));
    }

    void AddFlyMovement(Transform t, Vector3 min, Vector3 max, float speed)
    {
        StartCoroutine(PerlinMove(t, min, max, speed));
    }

    IEnumerator PerlinMove(Transform t, Vector3 min, Vector3 max, float speed)
    {
        float ox = Random.Range(0f, 1000f), oy = Random.Range(0f, 1000f), oz = Random.Range(0f, 1000f);
        while (t != null)
        {
            float time = Time.time * speed;
            float px = Mathf.PerlinNoise(time + ox, 0f);
            float py = Mathf.PerlinNoise(time + oy, 0f);
            float pz = Mathf.PerlinNoise(time + oz, 0f);
            t.localPosition = new Vector3(
                Mathf.Lerp(min.x, max.x, px),
                Mathf.Lerp(min.y, max.y, py),
                Mathf.Lerp(min.z, max.z, pz));
            yield return null;
        }
    }

    void AddTrail(GameObject go, Color color)
    {
        var trail = go.AddComponent<TrailRenderer>();
        trail.time = 2f;
        trail.startWidth = 0.1f;
        trail.endWidth = 0f;
        trail.material = new Material(Shader.Find("Sprites/Default"));
        trail.startColor = color;
        trail.endColor = new Color(color.r, color.g, color.b, 0f);
    }

    void AddSphere(GameObject go)
    {
        var sphere = GameObject.CreatePrimitive(PrimitiveType.Sphere);
        sphere.transform.SetParent(go.transform);
        sphere.transform.localPosition = Vector3.zero;
        sphere.transform.localScale = Vector3.one * 0.3f;
        Destroy(sphere.GetComponent<Collider>());
    }
}
