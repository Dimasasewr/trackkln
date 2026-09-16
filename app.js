(() => {
  const CFG = window.KARSA_CONFIG || {};
  const hasSupabase = Boolean(
    CFG.SUPABASE_URL &&
    CFG.SUPABASE_KEY &&
    window.supabase
  );

  const client = hasSupabase
    ? window.supabase.createClient(
        CFG.SUPABASE_URL,
        CFG.SUPABASE_KEY
      )
    : null;

  let state = {
    user: null,
    jobs: [],
    activities: [],
    currentView: "dashboard",
    filterText: "",
    filterStatus: "",
    filterDivision: ""
  };

  const $ = id => document.getElementById(id);

  const today = () =>
    new Date().toISOString().slice(0, 10);

  const esc = s =>
    String(s ?? "").replace(
      /[&<>"']/g,
      m =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;"
        })[m]
    );

  const initials = name =>
    String(name || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(x => x[0])
      .join("")
      .toUpperCase() || "K";

  const roleLabel = role =>
    ({
      director: "Director",
      general_manager: "General Manager",
      operational_head: "Head Divisi Operasional",
      division_head: "Head Divisi",
      staff: "Staff"
    })[role] || role;

  const dateFmt = d =>
    d
      ? new Intl.DateTimeFormat("id-ID", {
          day: "2-digit",
          month: "short",
          year: "numeric"
        }).format(new Date(d + "T00:00:00"))
      : "—";

  const statusClass = s =>
    s === "Selesai"
      ? "done"
      : s === "Terkendala"
      ? "blocked"
      : s === "Siap Review"
      ? "review"
      : s === "Menunggu"
      ? "wait"
      : "";

  /*
   * =========================================================
   * HAK AKSES
   * =========================================================
   *
   * Director:
   * - Bisa memberikan jobdesk
   * - Bisa melihat seluruh pekerjaan
   *
   * General Manager:
   * - Bisa memberikan jobdesk
   * - Bisa melihat seluruh pekerjaan
   *
   * Head Divisi Operasional:
   * - Bisa memberikan jobdesk
   * - Bisa melihat seluruh pekerjaan
   *
   * Head Divisi / Staff:
   * - Hanya melihat pekerjaan divisinya
   *
   * Update progres:
   * - HANYA PIC yang ditunjuk
   */

  const canAssign = () =>
    [
      "director",
      "general_manager",
      "operational_head"
    ].includes(state.user?.role);

  const canMonitorAll = () =>
    [
      "director",
      "general_manager",
      "operational_head"
    ].includes(state.user?.role);

  const canEditProgress = job =>
    Boolean(
      state.user &&
      job.assigneeId === state.user.id
    );

  function canSee(job) {
    if (!state.user) return false;

    if (canMonitorAll()) {
      return true;
    }

    return (
      job.division ===
      state.user.division
    );
  }

  function visibleJobs() {
    return state.jobs.filter(canSee);
  }

  /*
   * =========================================================
   * LOAD JOBS
   * =========================================================
   */

  async function loadJobs() {
    if (client) {
      const {
        data,
        error
      } = await client
        .from("jobs")
        .select("*")
        .order("updated_at", {
          ascending: false
        });

      if (!error && data) {
        state.jobs = data.map(normalizeJob);
      } else {
        state.jobs = [];

        showToast(
          "Database belum terhubung atau tabel jobs belum dibuat."
        );
      }
    } else {
      state.jobs = JSON.parse(
        localStorage.getItem(
          "karsa_jobs"
        ) || "[]"
      );
    }
  }

  function normalizeJob(j) {
    return {
      id: j.id,

      title: j.title,

      division:
        j.assigned_division ||
        j.division,

      assigneeId:
        j.assignee_id ||
        j.assigneeId ||
        "",

      assignee:
        j.assignee_name ||
        j.assignee ||
        "",

      deadline: j.deadline,

      progress: Number(
        j.progress || 0
      ),

      status:
        j.status ||
        "Belum Mulai",

      priority:
        j.priority ||
        "Normal",

      description:
        j.description ||
        "",

      blocker:
        j.blocker ||
        "",

      nextAction:
        j.next_action ||
        j.nextAction ||
        "",

      createdBy:
        j.created_by ||
        "",

      updated:
        j.updated_at
          ? new Date(
              j.updated_at
            ).toLocaleString(
              "id-ID",
              {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit"
              }
            )
          : "—"
    };
  }

  /*
   * =========================================================
   * UPDATE JOB
   * =========================================================
   */

  async function updateJob(
    job,
    patch
  ) {
    if (!canEditProgress(job)) {
      showToast(
        "Hanya PIC yang dipilih untuk pekerjaan ini yang dapat memperbarui progres."
      );

      return false;
    }

    const next = {
      ...job,
      ...patch
    };

    if (
      Number(next.progress) >= 100 &&
      next.status === "In Progress"
    ) {
      next.status =
        "Siap Review";
    }

    if (client) {
      const payload = {
        progress: next.progress,
        status: next.status,
        blocker: next.blocker,
        next_action:
          next.nextAction
      };

      const {
        data,
        error
      } = await client
        .from("jobs")
        .update(payload)
        .eq("id", job.id)
        .eq(
          "assignee_id",
          state.user.id
        )
        .select("*")
        .single();

      if (error) {
        showToast(
          error.message
        );

        return false;
      }

      const idx =
        state.jobs.findIndex(
          x =>
            x.id === job.id
        );

      if (idx >= 0) {
        state.jobs[idx] =
          normalizeJob(data);
      }

      await client
        .from(
          "progress_history"
        )
        .insert({
          job_id: job.id,
          progress:
            next.progress,
          status:
            next.status,
          note:
            next.nextAction ||
            next.blocker ||
            "",
          updated_by:
            state.user.id
        });
    } else {
      const idx =
        state.jobs.findIndex(
          x =>
            x.id === job.id
        );

      if (idx >= 0) {
        state.jobs[idx] =
          next;
      }

      localStorage.setItem(
        "karsa_jobs",
        JSON.stringify(
          state.jobs
        )
      );
    }

    addActivity(
      `${state.user.name} memperbarui "${next.title}"`,
      `${next.progress}% • ${next.status}`
    );

    renderAll();

    return true;
  }

  /*
   * =========================================================
   * CREATE JOB
   * =========================================================
   */

  async function createJob(data) {
    if (!canAssign()) {
      showToast(
        "Hanya Director / General Manager / Head Divisi Operasional yang dapat memberikan pekerjaan."
      );

      return false;
    }

    if (
      !data.title ||
      !data.assigneeId ||
      !data.division ||
      !data.deadline
    ) {
      showToast(
        "Lengkapi nama pekerjaan, divisi, PIC, dan deadline."
      );

      return false;
    }

    const newJob = {
      id:
        "KRS-" +
        Date.now(),

      title:
        data.title,

      division:
        data.division,

      assigneeId:
        data.assigneeId,

      assignee:
        data.assignee,

      deadline:
        data.deadline,

      progress: 0,

      status:
        "Belum Mulai",

      priority:
        data.priority,

      description:
        data.description,

      blocker: "",

      nextAction:
        data.nextAction,

      updated:
        "Baru"
    };

    if (client) {
      const {
        data: row,
        error
      } = await client
        .from("jobs")
        .insert({
          title:
            newJob.title,

          assigned_division:
            newJob.division,

          assignee_id:
            newJob.assigneeId,

          assignee_name:
            newJob.assignee,

          deadline:
            newJob.deadline,

          progress: 0,

          status:
            newJob.status,

          priority:
            newJob.priority,

          description:
            newJob.description,

          next_action:
            newJob.nextAction,

          created_by:
            state.user.id
        })
        .select("*")
        .single();

      if (error) {
        showToast(
          error.message
        );

        return false;
      }

      state.jobs.unshift(
        normalizeJob(row)
      );
    } else {
      state.jobs.unshift(
        newJob
      );

      localStorage.setItem(
        "karsa_jobs",
        JSON.stringify(
          state.jobs
        )
      );
    }

    addActivity(
      `Assignment dikirim ke ${newJob.division}`,
      `${newJob.title} → ${newJob.assignee}`
    );

    showToast(
      `Pekerjaan masuk ke ${newJob.division} • PIC: ${newJob.assignee}`
    );

    return true;
  }

  /*
   * =========================================================
   * ACTIVITY
   * =========================================================
   */

  function addActivity(
    title,
    detail
  ) {
    state.activities.unshift({
      title,
      detail,
      time: "Baru"
    });

    state.activities =
      state.activities.slice(
        0,
        8
      );

    localStorage.setItem(
      "karsa_demo_activity",
      JSON.stringify(
        state.activities
      )
    );
  }

  function loadActivities() {
    state.activities =
      JSON.parse(
        localStorage.getItem(
          "karsa_demo_activity"
        ) || "[]"
      );

    if (
      !state.activities.length
    ) {
      state.activities = [
        {
          title:
            "Workspace initialized",

          detail:
            "KARSA Executive Work Tracker",

          time:
            "Hari ini"
        },

        {
          title:
            "Routing aktif",

          detail:
            "Assignment → divisi tujuan",

          time:
            "Hari ini"
        }
      ];
    }
  }

  /*
   * =========================================================
   * RENDER
   * =========================================================
   */

  function renderAll() {
    renderUser();
    renderDashboard();
    renderJobs();
    renderMyJobs();
    renderWeekly();
    renderActivity();
  }

  function renderUser() {
    const u =
      state.user;

    if (!u) return;

    $("sideName").textContent =
      u.name;

    $("sideRole").textContent =
      `${roleLabel(u.role)} • ${u.division}`;

    $("sideAvatar").textContent =
      u.initials ||
      initials(u.name);

    $("mobileAvatar").textContent =
      u.initials ||
      initials(u.name);

    $("welcomeText").textContent =
      `${u.title || roleLabel(u.role)} • ${u.division}. Pantau pekerjaan yang berjalan dan pastikan next action selalu jelas.`;

    document
      .querySelectorAll(
        ".ops-only"
      )
      .forEach(el => {
        el.classList.toggle(
          "hidden",
          !canAssign()
        );
      });

    $("connectionText").textContent =
      client
        ? "Supabase connected"
        : "Preview mode";
  }

  /*
   * =========================================================
   * DASHBOARD
   * =========================================================
   */

  function renderDashboard() {
    const jobs =
      visibleJobs();

    const total =
      jobs.length;

    const progress =
      jobs.filter(
        j =>
          j.status ===
          "In Progress"
      ).length;

    const review =
      jobs.filter(
        j =>
          j.status ===
          "Siap Review"
      ).length;

    const blocked =
      jobs.filter(
        j =>
          j.status ===
          "Terkendala"
      ).length;

    const late =
      jobs.filter(
        j =>
          j.deadline &&
          j.deadline <
            today() &&
          j.status !==
            "Selesai"
      ).length;

    $("statTotal").textContent =
      total;

    $("statProgress").textContent =
      progress;

    $("statReview").textContent =
      review;

    $("statBlocked").textContent =
      blocked;

    $("statLate").textContent =
      late;

    const avg =
      total
        ? Math.round(
            jobs.reduce(
              (a, j) =>
                a +
                j.progress,
              0
            ) / total
          )
        : 0;

    $("heroProgress").textContent =
      avg + "%";

    const attention =
      jobs
        .filter(
          j =>
            j.status ===
              "Terkendala" ||
            (
              j.deadline <
                today() &&
              j.status !==
                "Selesai"
            ) ||
            j.status ===
              "Siap Review"
        )
        .slice(0, 5);

    $("attentionList").innerHTML =
      attention.length
        ? attention
            .map(
              j =>
                `<div class="attention-item">
                  <span class="bar ${
                    j.status ===
                    "Terkendala"
                      ? "red"
                      : ""
                  }"></span>
                  <div>
                    <strong>${esc(
                      j.title
                    )}</strong>
                    <small>
                      ${esc(
                        j.division
                      )} •
                      ${esc(
                        j.assignee
                      )} •
                      ${dateFmt(
                        j.deadline
                      )}
                    </small>
                  </div>
                  <span class="pct">
                    ${j.progress}%
                  </span>
                </div>`
            )
            .join("")
        : `<div class="empty">
            <div>✓</div>
            <h3>Tidak ada item kritis</h3>
            <p>
              Semua pekerjaan terlihat terkendali dari akun ini.
            </p>
          </div>`;

    const divisions = [
      "Finance",
      "IT",
      "Operasional",
      "R&D"
    ];

    $("divisionPulse").innerHTML =
      divisions
        .map(d => {
          const a =
            jobs.filter(
              j =>
                j.division ===
                d
            );

          const p =
            a.length
              ? Math.round(
                  a.reduce(
                    (x, j) =>
                      x +
                      j.progress,
                    0
                  ) /
                    a.length
                )
              : 0;

          return `
            <div class="division-row">
              <div class="division-label">
                <span>${d}</span>
                <span>
                  ${a.length} job • ${p}%
                </span>
              </div>

              <div class="division-track">
                <span
                  style="width:${p}%"
                ></span>
              </div>
            </div>
          `;
        })
        .join("");
  }

  /*
   * =========================================================
   * FILTER
   * =========================================================
   */

  function filteredJobs() {
    const q =
      state.filterText
        .toLowerCase();

    return visibleJobs().filter(
      j =>
        (
          !q ||
          `${j.title} ${j.assignee} ${j.division}`
            .toLowerCase()
            .includes(q)
        ) &&
        (
          !state.filterStatus ||
          j.status ===
            state.filterStatus
        ) &&
        (
          !state.filterDivision ||
          j.division ===
            state.filterDivision
        )
    );
  }

  /*
   * =========================================================
   * JOB TABLE
   * =========================================================
   */

  function renderJobs() {
    const jobs =
      filteredJobs();

    $("jobRows").innerHTML =
      jobs
        .map(
          j =>
            `<tr>
              <td>
                <strong>${esc(
                  j.title
                )}</strong>
                <small>
                  ${esc(
                    j.description
                  ).slice(
                    0,
                    80
                  )}
                </small>
              </td>

              <td>
                <strong>${esc(
                  j.division
                )}</strong>
                <small>
                  ${esc(
                    j.assignee
                  )}
                </small>
              </td>

              <td>
                ${dateFmt(
                  j.deadline
                )}

                ${
                  j.deadline <
                    today() &&
                  j.status !==
                    "Selesai"
                    ? `<small style="color:#d87979">
                        Lewat deadline
                      </small>`
                    : ""
                }
              </td>

              <td class="progress-cell">
                <div class="progress-top">
                  <span>
                    PROGRESS
                  </span>

                  <b>
                    ${j.progress}%
                  </b>
                </div>

                <div class="progress-track">
                  <span
                    style="width:${j.progress}%"
                  ></span>
                </div>
              </td>

              <td>
                <span class="status ${statusClass(
                  j.status
                )}">
                  ${esc(
                    j.status
                  )}
                </span>
              </td>

              <td>
                <button
                  class="row-action"
                  data-open-job="${j.id}"
                >
                  Buka
                </button>
              </td>
            </tr>`
        )
        .join("");

    $("jobEmpty").classList.toggle(
      "hidden",
      jobs.length > 0
    );
  }

  /*
   * =========================================================
   * MY JOBS
   * =========================================================
   */

  function renderMyJobs() {
    const jobs =
      visibleJobs().filter(
        j =>
          j.assigneeId ===
          state.user.id
      );

    $("myJobsGrid").innerHTML =
      jobs.length
        ? jobs
            .map(
              j =>
                `<article class="job-card">

                  <div class="card-meta">
                    <span class="status ${statusClass(
                      j.status
                    )}">
                      ${esc(
                        j.status
                      )}
                    </span>

                    <small style="color:#777">
                      ${esc(
                        j.priority
                      )}
                    </small>
                  </div>

                  <h3>
                    ${esc(
                      j.title
                    )}
                  </h3>

                  <p>
                    ${esc(
                      j.description ||
                        "Tidak ada deskripsi."
                    )}
                  </p>

                  <div class="deadline">
                    DEADLINE •
                    ${dateFmt(
                      j.deadline
                    )}
                  </div>

                  <div class="progress-top">
                    <span>
                      PROGRESS
                    </span>

                    <b>
                      ${j.progress}%
                    </b>
                  </div>

                  <div class="progress-track">
                    <span
                      style="width:${j.progress}%"
                    ></span>
                  </div>

                  <div class="next">
                    <b>
                      Next action
                    </b>

                    ${esc(
                      j.nextAction ||
                        "Belum ditentukan"
                    )}
                  </div>

                  <div class="card-bottom">

                    <small style="color:#666">
                      ${esc(
                        j.division
                      )}
                    </small>

                    <button
                      class="row-action"
                      data-open-job="${j.id}"
                    >
                      Update →
                    </button>

                  </div>

                </article>`
            )
            .join("")
        : `<div
            class="empty"
            style="grid-column:1/-1"
          >
            <div>◇</div>

            <h3>
              Queue kosong
            </h3>

            <p>
              Tidak ada pekerjaan yang ditugaskan ke akun ini.
            </p>
          </div>`;
  }

  /*
   * =========================================================
   * WEEKLY
   * =========================================================
   */

  function renderWeekly() {
    const jobs =
      visibleJobs();

    const avg =
      jobs.length
        ? Math.round(
            jobs.reduce(
              (a, j) =>
                a +
                j.progress,
              0
            ) /
              jobs.length
          )
        : 0;

    $("weeklyPercent").textContent =
      avg + "%";

    const counts = [
      "Belum Mulai",
      "In Progress",
      "Menunggu",
      "Terkendala",
      "Siap Review",
      "Selesai"
    ].map(
      s => [
        s,
        jobs.filter(
          j =>
            j.status === s
        ).length
      ]
    );

    $("weeklyStatus").innerHTML =
      counts
        .map(
          ([s, n]) =>
            `<div class="summary-line">
              <span>${s}</span>
              <span>${n}</span>
            </div>`
        )
        .join("");

    const follow =
      jobs
        .filter(
          j =>
            j.status ===
              "Terkendala" ||
            j.status ===
              "Siap Review" ||
            j.deadline <
              today()
        )
        .slice(0, 7);

    $("weeklyFollowup").innerHTML =
      follow.length
        ? follow
            .map(
              j =>
                `<div class="follow-item">
                  <strong>
                    ${esc(
                      j.title
                    )}
                  </strong>

                  <small>
                    ${esc(
                      j.division
                    )} •
                    ${esc(
                      j.status
                    )} •
                    ${esc(
                      j.nextAction ||
                        j.blocker ||
                        "Follow-up diperlukan"
                    )}
                  </small>
                </div>`
            )
            .join("")
        : `<div class="empty">
            <div>✓</div>
            <h3>
              Belum ada follow-up
            </h3>
          </div>`;

    const bars = [
      ["M", 0.55],
      ["T", 0.68],
      ["W", 0.72],
      ["T", 0.77],
      ["F", avg / 100],
      ["S", 0.35],
      ["M", 0.22]
    ];

    $("weekBars").innerHTML =
      bars
        .map(
          ([d, p]) =>
            `<div class="week-bar">
              <span
                style="height:${Math.max(
                  8,
                  p * 100
                )}px"
              ></span>

              <small>
                ${d}
              </small>
            </div>`
        )
        .join("");
  }

  /*
   * =========================================================
   * ACTIVITY
   * =========================================================
   */

  function renderActivity() {
    $("activityList").innerHTML =
      state.activities
        .map(
          a =>
            `<div class="activity-item">

              <div class="activity-icon">
                ✦
              </div>

              <div>
                <strong>
                  ${esc(
                    a.title
                  )}
                </strong>

                <small>
                  ${esc(
                    a.detail
                  )}
                </small>
              </div>

              <span class="activity-time">
                ${esc(
                  a.time
                )}
              </span>

            </div>`
        )
        .join("");
  }

  /*
   * =========================================================
   * VIEW
   * =========================================================
   */

  function showView(view) {
    state.currentView =
      view;

    document
      .querySelectorAll(
        ".view"
      )
      .forEach(v =>
        v.classList.remove(
          "active"
        )
      );

    $("view-" + view)
      ?.classList.add(
        "active"
      );

    document
      .querySelectorAll(
        ".nav-item"
      )
      .forEach(n =>
        n.classList.toggle(
          "active",
          n.dataset.view ===
            view
        )
      );

    const titles = {
      dashboard: [
        "EXECUTIVE WORKSPACE",
        "Overview"
      ],

      jobs: [
        "WORK REGISTER",
        "Pekerjaan"
      ],

      myjobs: [
        "PERSONAL QUEUE",
        "Pekerjaan Saya"
      ],

      create: [
        "ASSIGNMENT DESK",
        "Berikan Pekerjaan"
      ],

      weekly: [
        "WEEKLY REVIEW",
        "Evaluasi Mingguan"
      ],

      structure: [
        "ORGANIZATION",
        "Struktur Akses"
      ]
    };

    $("pageEyebrow").textContent =
      titles[view]?.[0] ||
      "KARSA";

    $("pageTitle").textContent =
      titles[view]?.[1] ||
      "Workspace";

    $("sidebar").classList.remove(
      "open"
    );
  }

  /*
   * =========================================================
   * JOB MODAL
   * =========================================================
   */

  function openJob(jobId) {
    const j =
      state.jobs.find(
        x =>
          x.id === jobId
      );

    if (!j) return;

    const editable =
      canEditProgress(j);

    $("modalTitle").textContent =
      j.title;

    $("modalBody").innerHTML = `
      <div class="update-info">

        <strong>
          ${esc(
            j.division
          )} •
          ${esc(
            j.assignee
          )}
        </strong>

        <small>
          Deadline
          ${dateFmt(
            j.deadline
          )}
          • Prioritas
          ${esc(
            j.priority
          )}
        </small>

      </div>

      <div class="update-grid">

        <label>
          Progress (%)

          <input
            id="uProgress"
            type="number"
            min="0"
            max="100"
            value="${j.progress}"
            ${
              editable
                ? ""
                : "disabled"
            }
          >
        </label>

        <label>
          Status

          <select
            id="uStatus"
            ${
              editable
                ? ""
                : "disabled"
            }
          >

            ${
              [
                "Belum Mulai",
                "In Progress",
                "Menunggu",
                "Terkendala",
                "Siap Review",
                "Selesai"
              ]
                .map(
                  s =>
                    `<option ${
                      s ===
                      j.status
                        ? "selected"
                        : ""
                    }>
                      ${s}
                    </option>`
                )
                .join("")
            }

          </select>
        </label>

        <label class="wide">
          Kendala

          <textarea
            id="uBlocker"
            rows="3"
            ${
              editable
                ? ""
                : "disabled"
            }
          >${esc(
            j.blocker
          )}</textarea>
        </label>

        <label class="wide">
          Next action / kebutuhan follow-up

          <textarea
            id="uNext"
            rows="3"
            ${
              editable
                ? ""
                : "disabled"
            }
          >${esc(
            j.nextAction
          )}</textarea>
        </label>

      </div>

      <div class="form-actions">

        <button
          class="btn-ghost"
          data-close-modal
        >
          Tutup
        </button>

        ${
          editable
            ? `<button
                id="saveUpdate"
                class="btn-gold"
              >
                Simpan update →
              </button>`
            : ""
        }

      </div>
    `;

    $("jobModal").classList.remove(
      "hidden"
    );

    $("saveUpdate")
      ?.addEventListener(
        "click",
        async () => {
          const ok =
            await updateJob(
              j,
              {
                progress:
                  Number(
                    $(
                      "uProgress"
                    ).value
                  ),

                status:
                  $(
                    "uStatus"
                  ).value,

                blocker:
                  $(
                    "uBlocker"
                  ).value,

                nextAction:
                  $(
                    "uNext"
                  ).value
              }
            );

          if (ok) {
            closeModal();

            showToast(
              "Update tersimpan."
            );
          }
        }
      );
  }

  function closeModal() {
    $("jobModal").classList.add(
      "hidden"
    );
  }

  /*
   * =========================================================
   * LOGIN
   * =========================================================
   */

  async function realLogin(
    email,
    password
  ) {
    const {
      data,
      error
    } =
      await client.auth.signInWithPassword(
        {
          email,
          password
        }
      );

    if (error) {
      throw error;
    }

    const uid =
      data.user.id;

    const {
      data: profile,
      error: pe
    } =
      await client
        .from("profiles")
        .select("*")
        .eq("id", uid)
        .single();

    if (pe || !profile) {
      throw new Error(
        "Akun berhasil login, tetapi profil internal belum dibuat."
      );
    }

    state.user = {
      id: uid,
      name: profile.name,
      email: profile.email,
      role: profile.role,
      division:
        profile.division,
      initials:
        initials(
          profile.name
        ),
      title:
        profile.title ||
        roleLabel(
          profile.role
        )
    };
  }

  /*
   * =========================================================
   * ENTER APP
   * =========================================================
   */

  async function enterApp() {
    $("loginPage").classList.add(
      "hidden"
    );

    $("app").classList.remove(
      "hidden"
    );

    await loadJobs();

    loadActivities();

    await loadAssignees();

    renderAll();

    showView(
      "dashboard"
    );
  }

  /*
   * =========================================================
   * LOGOUT
   * =========================================================
   */

  async function logout() {
    if (client) {
      await client.auth.signOut();
    }

    state.user = null;

    $("app").classList.add(
      "hidden"
    );

    $("loginPage").classList.remove(
      "hidden"
    );
  }

  /*
   * =========================================================
   * TOAST
   * =========================================================
   */

  function showToast(msg) {
    const t =
      $("toast");

    if (!t) return;

    t.textContent =
      msg;

    t.classList.add(
      "show"
    );

    clearTimeout(
      window.__toast
    );

    window.__toast =
      setTimeout(
        () =>
          t.classList.remove(
            "show"
          ),
        2600
      );
  }

  /*
   * =========================================================
   * EXPORT CSV
   * =========================================================
   */

  function exportCSV() {
    const rows = [
      [
        "ID",
        "Pekerjaan",
        "Divisi",
        "PIC",
        "Deadline",
        "Progress",
        "Status",
        "Prioritas",
        "Kendala",
        "Next Action"
      ],

      ...visibleJobs().map(
        j => [
          j.id,
          j.title,
          j.division,
          j.assignee,
          j.deadline,
          j.progress,
          j.status,
          j.priority,
          j.blocker,
          j.nextAction
        ]
      )
    ];

    const csv =
      rows
        .map(
          r =>
            r
              .map(
                v =>
                  `"${String(
                    v ?? ""
                  ).replaceAll(
                    '"',
                    '""'
                  )}"`
              )
              .join(",")
        )
        .join("\n");

    const a =
      document.createElement(
        "a"
      );

    a.href =
      URL.createObjectURL(
        new Blob(
          [csv],
          {
            type:
              "text/csv"
          }
        )
      );

    a.download =
      "karsa-weekly-review.csv";

    a.click();

    URL.revokeObjectURL(
      a.href
    );
  }

  /*
   * =========================================================
   * LOAD ASSIGNEES
   * =========================================================
   *
   * Director / GM / HDO dapat memilih:
   *
   * - General Manager
   * - Head Divisi Operasional
   * - Head Divisi
   * - Staff
   *
   * Director tidak dimasukkan sebagai PIC.
   */

  async function loadAssignees() {
    const select =
      document.querySelector(
        'select[name="assigneeId"]'
      );

    if (!select) return;

    if (!client) {
      select.innerHTML =
        '<option value="">Hubungkan Supabase untuk memilih akun</option>';

      return;
    }

    const {
      data,
      error
    } =
      await client
        .from("profiles")
        .select(
          "id,name,email,division,role"
        )
        .order(
          "division"
        )
        .order(
          "name"
        );

    if (error) {
      select.innerHTML =
        '<option value="">Gagal memuat akun</option>';

      return;
    }

    select.innerHTML =
      '<option value="">Pilih PIC...</option>' +

      data
        .filter(
          p =>
            [
              "general_manager",
              "operational_head",
              "division_head",
              "staff"
            ].includes(
              p.role
            )
        )
        .map(
          p =>
            `<option
              value="${p.id}"
              data-name="${esc(
                p.name
              )}"
              data-division="${esc(
                p.division
              )}"
            >
              ${esc(
                p.name
              )} •
              ${esc(
                p.division
              )} •
              ${roleLabel(
                p.role
              )}
            </option>`
        )
        .join("");
  }

  /*
   * =========================================================
   * BIND EVENTS
   * =========================================================
   */

  function bind() {

    document
      .querySelectorAll(
        ".nav-item"
      )
      .forEach(
        b =>
          b.addEventListener(
            "click",
            () =>
              showView(
                b.dataset.view
              )
          )
      );

    document
      .querySelectorAll(
        "[data-view-link]"
      )
      .forEach(
        b =>
          b.addEventListener(
            "click",
            () =>
              showView(
                b.dataset.viewLink
              )
          )
      );

    $("menuBtn").addEventListener(
      "click",
      () =>
        $("sidebar").classList.toggle(
          "open"
        )
    );

    $("togglePass").addEventListener(
      "click",
      () => {
        $("loginPassword").type =
          $("loginPassword").type ===
          "password"
            ? "text"
            : "password";
      }
    );

    /*
     * LOGIN
     */

    $("loginForm").addEventListener(
      "submit",
      async e => {
        e.preventDefault();

        $("loginError").textContent =
          "";

        if (!client) {
          $("loginError").textContent =
            "Sistem belum terhubung ke Supabase. Hubungkan config.js terlebih dahulu.";

          return;
        }

        try {
          await realLogin(
            $(
              "loginEmail"
            ).value.trim(),

            $(
              "loginPassword"
            ).value
          );

          await enterApp();

        } catch (err) {
          $("loginError").textContent =
            err.message ||
            "Login gagal.";
        }
      }
    );

    /*
     * LOGOUT
     */

    $("logoutBtn").addEventListener(
      "click",
      logout
    );

    /*
     * SEARCH
     */

    $("searchJobs").addEventListener(
      "input",
      e => {
        state.filterText =
          e.target.value;

        renderJobs();
      }
    );

    /*
     * STATUS FILTER
     */

    $("statusFilter").addEventListener(
      "change",
      e => {
        state.filterStatus =
          e.target.value;

        renderJobs();
      }
    );

    /*
     * DIVISION FILTER
     */

    $("divisionFilter").addEventListener(
      "change",
      e => {
        state.filterDivision =
          e.target.value;

        renderJobs();
      }
    );

    /*
     * NEW JOB
     */

    $("newJobBtn").addEventListener(
      "click",
      () =>
        showView(
          "create"
        )
    );

    $("quickAdd").addEventListener(
      "click",
      () =>
        showView(
          "create"
        )
    );

    /*
     * JOB FORM
     *
     * PENTING:
     * sebelumnya memakai isOps()
     * yang tidak pernah didefinisikan.
     *
     * Sekarang menggunakan canAssign().
     */

    $("jobForm").addEventListener(
      "submit",
      async e => {
        e.preventDefault();

        if (!canAssign()) {
          showToast(
            "Akun ini tidak memiliki akses untuk memberikan pekerjaan."
          );

          return;
        }

        const f =
          new FormData(
            e.currentTarget
          );

        const opt =
          document.querySelector(
            'select[name="assigneeId"] option:checked'
          );

        const selectedDivision =
          f.get(
            "division"
          );

        const selectedAssigneeId =
          f.get(
            "assigneeId"
          );

        /*
         * Pastikan PIC dipilih
         */

        if (
          !selectedAssigneeId
        ) {
          showToast(
            "Pilih PIC terlebih dahulu."
          );

          return;
        }

        /*
         * Pastikan PIC berasal
         * dari divisi yang sama.
         */

        const picDivision =
          opt?.dataset
            .division || "";

        if (
          picDivision &&
          picDivision !==
            selectedDivision
        ) {
          showToast(
            "PIC harus berasal dari divisi tujuan."
          );

          return;
        }

        const ok =
          await createJob({
            title:
              f.get(
                "title"
              ),

            division:
              selectedDivision,

            assigneeId:
              selectedAssigneeId,

            assignee:
              opt?.dataset
                .name ||
              "",

            deadline:
              f.get(
                "deadline"
              ),

            priority:
              f.get(
                "priority"
              ),

            description:
              f.get(
                "description"
              ),

            nextAction:
              f.get(
                "nextAction"
              )
          });

        if (ok) {
          e.currentTarget.reset();

          $("routeDivision").textContent =
            "Finance";

          $("routePic").textContent =
            "PIC";

          renderAll();

          showView(
            "jobs"
          );
        }
      }
    );

    /*
     * DIVISION ROUTING
     */

    document
      .querySelector(
        'select[name="division"]'
      )
      .addEventListener(
        "change",
        e => {
          $("routeDivision").textContent =
            e.target.value;

          /*
           * Reset PIC agar tidak
           * salah divisi setelah
           * tujuan berubah.
           */

          const picSelect =
            document.querySelector(
              'select[name="assigneeId"]'
            );

          if (
            picSelect
          ) {
            picSelect.value =
              "";

            $("routePic").textContent =
              "PIC";
          }
        }
      );

    /*
     * PIC ROUTING
     */

    document
      .querySelector(
        'select[name="assigneeId"]'
      )
      .addEventListener(
        "change",
        e => {
          const opt =
            e.target
              .selectedOptions[0];

          $("routePic").textContent =
            opt?.dataset
              .name ||
            "PIC";
        }
      );

    /*
     * EXPORT
     */

    $("exportBtn").addEventListener(
      "click",
      exportCSV
    );

    /*
     * OPEN JOB / CLOSE MODAL
     */

    document.addEventListener(
      "click",
      e => {
        const b =
          e.target.closest(
            "[data-open-job]"
          );

        if (b) {
          openJob(
            b.dataset.openJob
          );
        }

        if (
          e.target.matches(
            "[data-close-modal]"
          ) ||
          e.target.closest(
            "[data-close-modal]"
          )
        ) {
          closeModal();
        }
      }
    );
  }

  /*
   * =========================================================
   * CLOCK
   * =========================================================
   */

  function tick() {
    $("clock").textContent =
      new Intl.DateTimeFormat(
        "id-ID",
        {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        }
      ).format(
        new Date()
      );
  }

  /*
   * =========================================================
   * BOOT
   * =========================================================
   */

  async function boot() {

    bind();

    setInterval(
      tick,
      1000
    );

    tick();

    setTimeout(
      () => {

        $("bootStatus").textContent =
          "Opening secure workspace";

        setTimeout(
          () => {

            $("boot").classList.add(
              "out"
            );

            $("loginPage").classList.remove(
              "hidden"
            );

            if (
              CFG.DEMO_MODE
            ) {
              $("demoBox").classList.remove(
                "hidden"
              );
            }

          },
          650
        );

      },
      900
    );

    /*
     * =======================================================
     * SUPABASE SESSION
     * =======================================================
     */

    if (client) {

      const {
        data
      } =
        await client.auth.getSession();

      if (
        data.session
      ) {

        const {
          data: p
        } =
          await client
            .from(
              "profiles"
            )
            .select("*")
            .eq(
              "id",
              data.session
                .user.id
            )
            .single();

        if (p) {

          state.user = {
            id:
              data.session
                .user.id,

            name:
              p.name,

            email:
              p.email,

            role:
              p.role,

            division:
              p.division,

            initials:
              initials(
                p.name
              ),

            title:
              p.title ||
              roleLabel(
                p.role
              )
          };

          await enterApp();
        }
      }

      /*
       * AUTH STATE
       */

      client.auth.onAuthStateChange(
        async (
          event,
          session
        ) => {

          if (
            event ===
            "SIGNED_OUT"
          ) {

            state.user =
              null;

            $("app").classList.add(
              "hidden"
            );

            $("loginPage").classList.remove(
              "hidden"
            );

            return;
          }

          if (
            session &&
            !state.user
          ) {

            const {
              data: p
            } =
              await client
                .from(
                  "profiles"
                )
                .select("*")
                .eq(
                  "id",
                  session.user.id
                )
                .single();

            if (p) {

              state.user = {
                id:
                  session.user.id,

                name:
                  p.name,

                email:
                  p.email,

                role:
                  p.role,

                division:
                  p.division,

                initials:
                  initials(
                    p.name
                  ),

                title:
                  p.title ||
                  roleLabel(
                    p.role
                  )
              };

              await enterApp();
            }
          }
        }
      );
    }
  }

  /*
   * =========================================================
   * START
   * =========================================================
   */

  boot();

})();
