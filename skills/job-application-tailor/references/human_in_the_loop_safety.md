# Safety Protocol: Human-in-the-Loop in the Application

The assistant is permitted to collect data, navigate the job portal and fill in forms, but it will **NEVER** submit an application autonomously without the user's explicit approval.

## Mandatory Rules:

1. **Dry run and assisted filling:**
   - Playwright may navigate to the application page (`apply_assistant.mjs`).
   - Map and fill textual fields (Name, Email, Phone, LinkedIn, Portfolio).
   - Attach the tailored resume (generated PDF).
   - Fill drafts of open answers based on the candidate's base profile.

2. **Pause for visual audit:**
   - The script captures a screenshot of the full page with the fields filled in (`preview_before_submit.png`).
   - Generates a JSON report with every inserted value.

3. **Explicit user confirmation:**
   - The assistant shows the user a summary of the filled data and the preview image.
   - Asks explicitly:
     > *"O formulário da vaga na empresa X para o cargo Y foi pré-preenchido e o currículo direcionado foi anexado. Você aprova o envio definitivo ou prefere revisar/enviar manualmente pelo link?"*
    - Under **no circumstances** will the final "Enviar Candidatura" / "Submit Application" button be triggered without an unambiguous "yes" from the user.
